'use server';

import type {
  Repository,
  GithubRelease,
  EnrichedRelease,
  RateLimitResult,
  AppSettings,
  PreReleaseChannelType,
  FetchError,
  AppriseStatus,
  CachedRelease,
} from '@/types';
import { allPreReleaseTypes } from '@/types';
import {sendNotification, sendTestAppriseNotification} from '@/lib/notifications';
import {getRepositories, saveRepositories} from '@/lib/repository-storage';
import {revalidatePath, revalidateTag, unstable_cache} from 'next/cache';
import { getSettings } from '@/lib/settings-storage';
import { getLocale, getTranslations } from 'next-intl/server';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { sendTestEmail } from '@/lib/email';


function parseGitHubUrl(url: string): {owner: string; repo: string; id: string} | null {
  try {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;
    const urlObj = new URL(trimmedUrl);
    if (urlObj.hostname !== 'github.com') return null;

    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      const [owner, repo] = pathParts;
      return {owner, repo, id: `${owner}/${repo}`.toLowerCase()};
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Security: Validates the repoId format.
function isValidRepoId(repoId: string): boolean {
  if (typeof repoId !== 'string') return false;
  // Allows letters, numbers, hyphens, dots, and underscores in the name.
  // Enforces the "owner/repo" structure.
  const repoIdRegex = /^[a-z0-9-._]+\/[a-z0-9-._]+$/i;
  return repoIdRegex.test(repoId);
}


function isPreReleaseByTagName(tagName: string, preReleaseSubChannels?: PreReleaseChannelType[]): boolean {
  if (typeof tagName !== 'string' || !tagName) return false;

  // If no sub-channels are provided or the array is empty, it can't match anything.
  if (!preReleaseSubChannels || preReleaseSubChannels.length === 0) {
      return false;
  }

  // This regex looks for a separator (like - or .), then one of the keywords.
  // The (?=[^a-zA-Z]|$) is a positive lookahead. It asserts that the character
  // following the keyword is NOT a letter, or it's the end of the string.
  // This correctly matches `-b3` (since 3 is not a letter) and `v1.0-beta` (end of string),
  // but prevents incorrectly matching `beta` in `v1.0-betamax`.
  const preReleaseRegex = new RegExp(`[.-](${preReleaseSubChannels.join('|')})(?=[^a-zA-Z]|$)`, 'i');
  return preReleaseRegex.test(tagName);
}

function toCachedRelease(release: GithubRelease): CachedRelease {
  return {
    html_url: release.html_url,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    created_at: release.created_at,
    published_at: release.published_at,
    fetched_at: release.fetched_at,
  };
}

// This constant holds the non-translatable part of the test data.
const jsCodeExample = `function greet(name) {
  // This long line tests horizontal scrolling
  console.log('Hello, ' + name + '! This line is very long to test horizontal scrolling, so it should definitely overflow the container and not wrap around.');
}

greet('World');`;


async function getComprehensiveMarkdownBody(locale: string): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: 'TestRelease' });

  const body = `# ${t('title')}

${t('body_intro')}

## ${t('section_text_formatting')}

- **${t('text_bold')}**
- *${t('text_italic')}*
- ***${t('text_bold_italic')}***
- ~~${t('text_strikethrough')}~~

> ${t('text_blockquote')}

---

## ${t('section_lists')}

### ${t('list_unordered_title')}
*   ${t('list_item_1')}
*   ${t('list_item_2')}
    *   ${t('list_nested_item_1')}
    *   ${t('list_nested_item_2')}

### ${t('list_unordered_variations_title')}
+ ${t('list_plus_item_1')}
+ ${t('list_plus_item_2')}
- ${t('list_hyphen_item_1')}
- ${t('list_hyphen_item_2')}

### ${t('list_ordered_title')}
1.  ${t('list_ordered_item_1')}
2.  ${t('list_ordered_item_2')}
3.  ${t('list_ordered_item_3')}
    1.  ${t('list_nested_ordered_1')}
    2.  ${t('list_nested_ordered_2')}

---

## ${t('section_emojis')}

${t('emojis_text')} ✨ 🚀 💡

---

## ${t('section_footnotes')}

${t('footnotes_text_1')}[^1]. ${t('footnotes_text_2')}[^2].

[^1]: ${t('footnote_1_definition')}
[^2]: ${t('footnote_2_definition')}

---

## ${t('section_links')}

${t('links_text_1')} [${t('links_text_2')}](https://www.markdownguide.org).

---

## ${t('section_code_blocks')}

### ${t('code_inline_title')}
${t('code_inline_text', {
  code: `\`${t('code_inline_code_word')}\``
})}

### ${t('code_fenced_title')}
\`\`\`javascript
// ${t('code_fenced_js_comment')}
${jsCodeExample}
\`\`\`

---

## ${t('section_table')}

| ${t('table_header_feature')} | ${t('table_header_support')} | ${t('table_header_notes')} |
|-----------------|------------------|-------------------------------------|
| ${t('table_row1_feature')} | ${t('table_row1_support')} | ${t('table_row1_notes')} |
| ${t('table_row2_feature')} | ${t('table_row2_support')} | ${t('table_row2_notes')} |
| ${t('table_row3_feature')} | ${t('table_row3_support')} | ${t('table_row3_notes')} |
| ${t('table_row4_feature')} | ${t('table_row4_support')} | ${t('table_row4_notes')} |`;

  return {
      title: t('title'),
      body: body
  }
}

async function getBasicAppriseTestBody(locale: string): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: 'TestRelease' });

  const body = `${t('apprise_basic_test_title')}

- ${t('apprise_basic_item_bold')}
- ${t('apprise_basic_item_italic')}
- ${t('apprise_basic_item_code')}

> ${t('apprise_basic_blockquote')}

${t('apprise_basic_link_text')} (https://github.com/iamspido/github-release-monitor)`;

  return {
    title: t('apprise_basic_test_notification_title'),
    body: body,
  };
}


async function fetchLatestRelease(
  owner: string,
  repo: string,
  repoSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'etag'>,
  globalSettings: AppSettings,
  locale: string
): Promise<{ release: GithubRelease | null; error: FetchError | null, newEtag?: string }> {
  const fetchedAtTimestamp = new Date().toISOString();

  // --- Determine effective settings ---
  const effectiveReleaseChannels = (repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0)
    ? repoSettings.releaseChannels
    : globalSettings.releaseChannels;

  const effectivePreReleaseSubChannels = (repoSettings.preReleaseSubChannels && repoSettings.preReleaseSubChannels.length > 0)
    ? repoSettings.preReleaseSubChannels
    : globalSettings.preReleaseSubChannels || allPreReleaseTypes;

  const totalReleasesToFetch = (typeof repoSettings.releasesPerPage === 'number' && repoSettings.releasesPerPage >= 1 && repoSettings.releasesPerPage <= 1000)
    ? repoSettings.releasesPerPage
    : globalSettings.releasesPerPage;

  const effectiveIncludeRegex = repoSettings.includeRegex ?? globalSettings.includeRegex;
  const effectiveExcludeRegex = repoSettings.excludeRegex ?? globalSettings.excludeRegex;

  // --- Special handling for the virtual test repository ---
  if (owner === 'test' && repo === 'test') {
    const { title, body } = await getComprehensiveMarkdownBody(locale);
    const release = {
      id: 1,
      html_url: 'https://github.com/test/test/releases/tag/v1.0.0-simulated',
      tag_name: 'v1.0.0-simulated',
      name: title,
      body: body,
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      prerelease: false,
      draft: false,
      fetched_at: fetchedAtTimestamp,
    };
    return { release, error: null };
  }

  // --- GitHub API Fetching with Pagination ---
  const GITHUB_API_BASE_URL = `https://api.github.com/repos/${owner}/${repo}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GitHubReleaseMonitorApp',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_ACCESS_TOKEN}`;
  }

  try {
    for (let page = 1; page <= pagesToFetch; page++) {
      const releasesOnThisPage = Math.min(MAX_PER_PAGE, totalReleasesToFetch - allReleases.length);
      if (releasesOnThisPage <= 0) break;

      const url = `${GITHUB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeaders = {...headers};
      // Only use ETag for the first page request.
      if (page === 1 && repoSettings.etag) {
          currentHeaders['If-None-Match'] = repoSettings.etag;
      }
      const fetchOptions: RequestInit = { headers: currentHeaders, cache: 'no-store' };

      const response = await fetch(url, fetchOptions);

      // For the first page, check for 304 Not Modified.
      if (page === 1) {
        newEtag = response.headers.get('etag') || undefined;
        if (response.status === 304) {
            console.log(`[ETag] No changes for ${owner}/${repo}.`);
            return { release: null, error: { type: 'not_modified' }, newEtag: repoSettings.etag };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          console.error(`GitHub API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`);
          return { release: null, error: { type: 'repo_not_found' }, newEtag };
        }
        if (response.status === 403) {
          const rateLimitLimit = response.headers.get('x-ratelimit-limit');
          const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
          const rateLimitReset = response.headers.get('x-ratelimit-reset');
          const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString() : 'N/A';

          console.error(
            `GitHub API rate limit exceeded for ${owner}/${repo}. ` +
            `Limit: ${rateLimitLimit}, Remaining: ${rateLimitRemaining}, Resets at: ${resetTime}. ` +
            'Please add or check your GITHUB_ACCESS_TOKEN.'
          );
          return { release: null, error: { type: 'rate_limit' }, newEtag };
        }
        console.error(`GitHub API error for ${owner}/${repo}: ${response.status} ${response.statusText}`);
        return { release: null, error: { type: 'api_error' }, newEtag };
      }

      const pageReleases: GithubRelease[] = await response.json();
      allReleases = [...allReleases, ...pageReleases];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      console.log(`No formal releases found for ${owner}/${repo}. Falling back to tags.`);
      const tagsResponse = await fetch(`${GITHUB_API_BASE_URL}/tags?per_page=1`, { headers, cache: 'no-store' });

      if (!tagsResponse.ok) {
          console.error(`Failed to fetch tags for ${owner}/${repo} after failing to find releases.`);
          return { release: null, error: { type: 'no_releases_found' }, newEtag };
      }

      const tags: {name: string, commit: {sha: string}}[] = await tagsResponse.json();
      if (!tags || tags.length === 0) {
          console.log(`No tags found for ${owner}/${repo}.`);
          return { release: null, error: { type: 'no_releases_found' }, newEtag };
      }

      const latestTag = tags[0];
      const t = await getTranslations({ locale, namespace: 'Actions' });

      let bodyContent = '';
      let publicationDate = new Date().toISOString();

      try {
        const refResponse = await fetch(`${GITHUB_API_BASE_URL}/git/ref/tags/${latestTag.name}`, { headers, cache: 'no-store' });

        if (refResponse.ok) {
            const refData = await refResponse.json();
            // If it's an annotated tag, the object type is 'tag'.
            if (refData.object.type === 'tag') {
                const annotatedTagResponse = await fetch(refData.object.url, { headers, cache: 'no-store' });
                if (annotatedTagResponse.ok) {
                    const annotatedTagData = await annotatedTagResponse.json();
                    if (annotatedTagData.message) {
                        bodyContent = `### ${t('tag_message_fallback_title')}\n\n---\n\n${annotatedTagData.message}`;
                    }
                    publicationDate = annotatedTagData.tagger.date;
                }
            }
        }

        // If no annotated tag message was found (either lightweight tag or error), fall back to commit message.
        if (!bodyContent) {
          const commitResponse = await fetch(`${GITHUB_API_BASE_URL}/commits/${latestTag.commit.sha}`, { headers, cache: 'no-store' });
          if (commitResponse.ok) {
            const commitData = await commitResponse.json();
            bodyContent = `### ${t('commit_message_fallback_title')}\n\n---\n\n${commitData.commit.message}`;
            publicationDate = commitData.commit.committer.date;
          } else {
             console.error(`Failed to fetch commit for tag ${latestTag.name} in ${owner}/${repo}.`);
             return { release: null, error: { type: 'api_error' }, newEtag };
          }
        }
      } catch (e) {
         console.error(`Error during tag fallback for ${owner}/${repo}:`, e);
         return { release: null, error: { type: 'api_error' }, newEtag };
      }

      const virtualRelease: GithubRelease = {
          id: 0, // Virtual release has no ID
          html_url: `https://github.com/${owner}/${repo}/releases/tag/${latestTag.name}`,
          tag_name: latestTag.name,
          name: `Tag: ${latestTag.name}`,
          body: bodyContent,
          created_at: publicationDate,
          published_at: publicationDate,
          prerelease: false,
          draft: false,
      };
      allReleases = [virtualRelease];
    }

    const filteredReleases = allReleases.filter(r => {
      try {
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, 'i');
          if (exclude.test(r.tag_name)) return false;
        }
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, 'i');
          return include.test(r.tag_name);
        }
      } catch (e) {
        console.error(`Invalid regex for repo ${owner}/${repo}. Regex filters will be ignored. Error:`, e);
      }

      if (r.draft) {
        return effectiveReleaseChannels.includes('draft');
      }

      const isConsideredPreRelease = r.prerelease || isPreReleaseByTagName(r.tag_name, allPreReleaseTypes);

      if (isConsideredPreRelease) {
        if (!effectiveReleaseChannels.includes('prerelease')) return false;
        return isPreReleaseByTagName(r.tag_name, effectivePreReleaseSubChannels);
      } else {
        return effectiveReleaseChannels.includes('stable');
      }
    });

    if (filteredReleases.length === 0) {
      return { release: null, error: { type: 'no_matching_releases' }, newEtag };
    }

    let latestRelease = filteredReleases[0];

    // This check is for formal releases that have an empty body.
    // The tag fallback already populates the body with a commit message.
    if (latestRelease.id !== 0 && (!latestRelease.body || latestRelease.body.trim() === '')) {
        console.log(`Release body for ${owner}/${repo} tag ${latestRelease.tag_name} is empty. Attempting to fetch commit message.`);
        const commitApiUrl = `${GITHUB_API_BASE_URL}/commits/${latestRelease.tag_name}`;
        try {
            const commitResponse = await fetch(commitApiUrl, { headers, cache: 'no-store' });
            if (commitResponse.ok) {
                const commitData = await commitResponse.json();
                if (commitData.commit && commitData.commit.message) {
                    const t = await getTranslations({ locale, namespace: 'Actions' });
                    latestRelease.body = `### ${t('commit_message_fallback_title')}\n\n---\n\n${commitData.commit.message}`;
                    console.log(`Successfully fetched commit message for ${owner}/${repo} tag ${latestRelease.tag_name}.`);
                } else {
                     console.log(`Commit message for ${owner}/${repo} tag ${latestRelease.tag_name} could not be retrieved from commit data.`);
                }
            } else {
                console.error(`Failed to fetch commit for ${owner}/${repo} tag ${latestRelease.tag_name}: ${commitResponse.status} ${commitResponse.statusText}`);
            }
        } catch (error) {
            console.error(`Error fetching commit for tag ${latestRelease.tag_name} in ${owner}/${repo}:`, error);
        }
    }

    if (latestRelease) {
      latestRelease.fetched_at = new Date().toISOString();
    }

    return { release: latestRelease, error: null, newEtag };

  } catch (error) {
    console.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: 'api_error' } };
  }
}

async function fetchLatestReleaseWithCache(
  owner: string,
  repo: string,
  repoSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'etag'>,
  globalSettings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean }
): Promise<{ release: GithubRelease | null; error: FetchError | null; newEtag?: string }> {
  if (globalSettings.cacheInterval <= 0 || options?.skipCache) {
    return fetchLatestRelease(owner, repo, repoSettings, globalSettings, locale);
  }

  const cacheIntervalSeconds = globalSettings.cacheInterval * 60;

  const effectiveReleasesPerPage = (typeof repoSettings.releasesPerPage === 'number' && repoSettings.releasesPerPage >= 1 && repoSettings.releasesPerPage <= 1000)
    ? repoSettings.releasesPerPage
    : globalSettings.releasesPerPage;

  const cachedFetch = unstable_cache(
    (ownerArg, repoArg, repoSettingsArg, globalSettingsArg, localeArg) => fetchLatestRelease(ownerArg, repoArg, repoSettingsArg, globalSettingsArg, localeArg),
    ['github-release', owner, repo, locale, JSON.stringify(repoSettings), String(effectiveReleasesPerPage)],
    {
      revalidate: cacheIntervalSeconds,
      tags: ['github-releases'],
    }
  );

  return cachedFetch(owner, repo, repoSettings, globalSettings, locale);
}


export async function getLatestReleasesForRepos(
  repositories: Repository[],
  settings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean }
): Promise<EnrichedRelease[]> {
  const enrichedReleases: EnrichedRelease[] = [];

  for (const repo of repositories) {
    const parsed = parseGitHubUrl(repo.url);
    if (!parsed) {
      enrichedReleases.push({
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: 'invalid_url' },
        isNew: repo.isNew,
      });
      continue;
    }

    const repoSettings = {
      releaseChannels: repo.releaseChannels,
      preReleaseSubChannels: repo.preReleaseSubChannels,
      releasesPerPage: repo.releasesPerPage,
      includeRegex: repo.includeRegex,
      excludeRegex: repo.excludeRegex,
      appriseTags: repo.appriseTags,
      appriseFormat: repo.appriseFormat,
      etag: repo.etag,
    };

    const { release: latestRelease, error, newEtag } = await fetchLatestReleaseWithCache(
      parsed.owner,
      parsed.repo,
      repoSettings,
      settings,
      locale,
      options
    );

    if (error?.type === 'not_modified') {
      const cached: CachedRelease | undefined = repo.latestRelease;
      const reconstructedRelease: GithubRelease | undefined = cached ? {
        ...cached,
        id: 0,
        prerelease: false,
        draft: false,
      } : undefined;

      if (reconstructedRelease) {
        reconstructedRelease.fetched_at = new Date().toISOString();
      }

      enrichedReleases.push({
        repoId: repo.id,
        repoUrl: repo.url,
        release: reconstructedRelease,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      });
      continue;
    }

    if (error) {
      enrichedReleases.push({
        repoId: repo.id,
        repoUrl: repo.url,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      });
      continue;
    }

    if (!latestRelease) {
      enrichedReleases.push({
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: 'api_error' },
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      });
      continue;
    }

    enrichedReleases.push({
      repoId: repo.id,
      repoUrl: repo.url,
      release: latestRelease,
      isNew: repo.isNew,
      repoSettings: repoSettings,
      newEtag: newEtag,
    });
  }

  return enrichedReleases;
}

export async function addRepositoriesAction(
  prevState: any,
  formData: FormData
): Promise<{
  success: boolean;
  toast?: {title: string; description: string};
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'RepositoryForm'});

  const urls = formData.get('urls');
  if (typeof urls !== 'string' || !urls.trim()) {
    return {success: false, error: t('toast_fail_description_manual', {failed: 1})};
  }

  const urlList = urls.split('\n').filter(u => u.trim() !== '');
  const newRepos: Repository[] = [];
  let failedCount = 0;

  for (const url of urlList) {
    const parsed = parseGitHubUrl(url);
    if (parsed) {
      newRepos.push({id: parsed.id, url: `https://github.com/${parsed.id}`});
    } else {
      failedCount++;
    }
  }

  if (newRepos.length === 0 && failedCount > 0) {
    return {success: false, error: t('toast_fail_description_manual', {failed: failedCount})};
  }

  try {
    const currentRepos = await getRepositories();
    const existingIds = new Set(currentRepos.map(r => r.id));
    const uniqueNewRepos = newRepos.filter(r => !existingIds.has(r.id));

    if (uniqueNewRepos.length > 0) {
      await saveRepositories([...currentRepos, ...uniqueNewRepos]);
      revalidatePath('/');
    }

    const addedCount = uniqueNewRepos.length;
    const skippedCount = newRepos.length - addedCount;

    return {
      success: true,
      toast: {
        title: t('toast_success_title'),
        description: t('toast_success_description_manual', {
          added: addedCount,
          skipped: skippedCount,
          failed: failedCount,
        }),
      },
    };
  } catch (error: any) {
    console.error('Failed to add repositories:', error);
    return {
      success: false,
      error: t('toast_save_error_generic'),
    };
  }
}

export async function importRepositoriesAction(importedData: Repository[]): Promise<{
  success: boolean;
  message: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'RepositoryForm'});
  const settings = await getSettings();

  try {
    const currentRepos = await getRepositories();
    const currentRepoIds = new Set(currentRepos.map(repo => repo.id));
    const currentReposMap = new Map(currentRepos.map(r => [r.id, r]));

    const validImportedRepos: Repository[] = [];
    for (const repo of importedData) {
      if (repo.id && repo.url && parseGitHubUrl(repo.url)) {
        validImportedRepos.push(repo);
      }
    }

    let addedCount = 0;
    let updatedCount = 0;

    for (const importedRepo of validImportedRepos) {
      if (currentRepoIds.has(importedRepo.id)) {
        updatedCount++;
      } else {
        addedCount++;
      }

      const repoToSave: Repository = {
        ...currentReposMap.get(importedRepo.id),
        id: importedRepo.id,
        url: importedRepo.url,
        lastSeenReleaseTag: importedRepo.lastSeenReleaseTag,
        etag: importedRepo.etag,
        isNew: (settings.showAcknowledge ?? true) ? (importedRepo.isNew ?? false) : false,
        releaseChannels: importedRepo.releaseChannels,
        preReleaseSubChannels: importedRepo.preReleaseSubChannels,
        releasesPerPage: importedRepo.releasesPerPage,
        includeRegex: importedRepo.includeRegex,
        excludeRegex: importedRepo.excludeRegex,
        appriseTags: importedRepo.appriseTags,
        appriseFormat: importedRepo.appriseFormat,
      };

      currentReposMap.set(importedRepo.id, repoToSave);
    }

    const finalList = Array.from(currentReposMap.values());
    await saveRepositories(finalList);
    revalidatePath('/');

    return {
      success: true,
      message: t('toast_import_success_description', {
        addedCount,
        updatedCount
      }),
    };

  } catch (error: any) {
    console.error('Failed to import repositories:', error);
    return {
      success: false,
      message: t('toast_save_error_generic'),
    };
  }
}

export async function removeRepositoryAction(repoId: string) {
  if (!isValidRepoId(repoId)) {
    console.error('Invalid repoId format for removal:', repoId);
    return;
  }
  const currentRepos = await getRepositories();
  const newRepos = currentRepos.filter(r => r.id !== repoId);
  await saveRepositories(newRepos);
  revalidatePath('/');
}

export async function acknowledgeNewReleaseAction(repoId: string): Promise<{ success: boolean; error?: string }> {
  if (!isValidRepoId(repoId)) {
    return { success: false, error: 'Invalid repository ID format.' };
  }
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'ReleaseCard'});
  try {
    const currentRepos = await getRepositories();
    const repoIndex = currentRepos.findIndex(r => r.id === repoId);

    if (repoIndex !== -1) {
      currentRepos[repoIndex].isNew = false;
      await saveRepositories(currentRepos);
      revalidatePath('/');
      return { success: true };
    }

    return { success: false, error: t('toast_acknowledge_error_not_found') };

  } catch (error: any) {
    console.error('Failed to acknowledge release:', error);
    return { success: false, error: t('toast_acknowledge_error_generic') };
  }
}

export async function markAsNewAction(repoId: string): Promise<{ success: boolean; error?: string }> {
  if (!isValidRepoId(repoId)) {
    return { success: false, error: 'Invalid repository ID format.' };
  }
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'ReleaseCard'});
  try {
    const currentRepos = await getRepositories();
    const repoIndex = currentRepos.findIndex(r => r.id === repoId);

    if (repoIndex !== -1) {
      currentRepos[repoIndex].isNew = true;
      await saveRepositories(currentRepos);
      revalidatePath('/');
      return { success: true };
    }

    return { success: false, error: t('toast_mark_as_new_error_not_found') };

  } catch (error: any) {
    console.error('Failed to mark release as new:', error);
    return { success: false, error: t('toast_mark_as_new_error_generic') };
  }
}

export async function checkForNewReleases(options?: { overrideLocale?: string, skipCache?: boolean }) {
  console.log(
    `[${new Date().toISOString()}] Running check for new releases...`
  );
  const settings = await getSettings();
  const effectiveLocale = options?.overrideLocale || settings.locale;

  const originalRepos = await getRepositories();
  if (originalRepos.length === 0) {
    console.log('No repositories to check.');
    return { notificationsSent: 0, checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    originalRepos,
    settings,
    effectiveLocale,
    { skipCache: options?.skipCache }
  );

  const updatedRepos = [...originalRepos];
  let changed = false;
  let notificationsSent = 0;

  for (const enrichedRelease of enrichedReleases) {
    const repoIndex = updatedRepos.findIndex(r => r.id === enrichedRelease.repoId);
    if (repoIndex === -1) continue;

    const repo = updatedRepos[repoIndex];
    let repoWasUpdated = false;

    if (enrichedRelease.newEtag && repo.etag !== enrichedRelease.newEtag) {
        repo.etag = enrichedRelease.newEtag;
        repoWasUpdated = true;
    }

    if (enrichedRelease.release) {
        const newCachedRelease = toCachedRelease(enrichedRelease.release);
        if (JSON.stringify(repo.latestRelease) !== JSON.stringify(newCachedRelease)) {
            repoWasUpdated = true;
        }
        repo.latestRelease = newCachedRelease;

        const newTag = enrichedRelease.release.tag_name;
        const isNewRelease = repo.lastSeenReleaseTag && repo.lastSeenReleaseTag !== newTag;

        if (isNewRelease) {
          console.log(
            `New release detected for ${repo.id}: ${newTag} (previously ${repo.lastSeenReleaseTag})`
          );

          const shouldHighlight = settings.showAcknowledge ?? true;
          repo.lastSeenReleaseTag = newTag;
          repo.isNew = shouldHighlight;
          repoWasUpdated = true;

          try {
              await sendNotification(repo, enrichedRelease.release, effectiveLocale, settings);
              notificationsSent++;
          } catch(e: any) {
            console.error(`Failed to send notification for ${repo.id}. The release tag HAS been updated to prevent repeated failures for the same release. Error: ${e.message}`);
          }
        } else if (!repo.lastSeenReleaseTag) {
          console.log(
            `First fetch for ${repo.id}, setting initial release tag to ${newTag}. No notification will be sent.`
          );
          repo.lastSeenReleaseTag = newTag;
          repo.isNew = false;
          repoWasUpdated = true;
        }
    }
    if (repoWasUpdated) {
        changed = true;
    }
  }

  if (changed) {
    console.log('Found changes, updating repository data file.');
    await saveRepositories(updatedRepos);
  } else {
    console.log('No new releases found.');
  }
   return { notificationsSent, checked: originalRepos.length };
}

async function backgroundPollingLoop() {
  try {
    await checkForNewReleases({ skipCache: true });
  } catch (error) {
    console.error("Error during background check for new releases:", error);
  } finally {
    const settings = await getSettings();
    let pollingIntervalMinutes = settings.refreshInterval;

    const MINIMUM_INTERVAL_MINUTES = 1;
    if (pollingIntervalMinutes < MINIMUM_INTERVAL_MINUTES) {
      pollingIntervalMinutes = MINIMUM_INTERVAL_MINUTES;
    }

    const pollingIntervalMs = pollingIntervalMinutes * 60 * 1000;

    console.log(`Next background check scheduled in ${pollingIntervalMinutes} minutes.`);
    setTimeout(backgroundPollingLoop, pollingIntervalMs);
  }
}

if (
  process.env.NODE_ENV === 'production' &&
  !process.env.BACKGROUND_POLLING_INITIALIZED
) {
  console.log("Initializing dynamic background polling.");
  process.env.BACKGROUND_POLLING_INITIALIZED = 'true';
  setTimeout(backgroundPollingLoop, 5000);
}

const TEST_REPO_ID = 'test/test';

export async function setupTestRepositoryAction(): Promise<{ success: boolean; message: string; }> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'TestPage'});

  try {
    const currentRepos = await getRepositories();
    const testRepoIndex = currentRepos.findIndex(r => r.id === TEST_REPO_ID);

    if (testRepoIndex > -1) {
      currentRepos[testRepoIndex].lastSeenReleaseTag = 'v0.9.0-reset';
      currentRepos[testRepoIndex].isNew = false;
    } else {
      currentRepos.push({
        id: TEST_REPO_ID,
        url: `https://github.com/${TEST_REPO_ID}`,
        lastSeenReleaseTag: 'v0.9.0-initial',
        isNew: false,
      });
    }

    await saveRepositories(currentRepos);
    revalidatePath('/');
    revalidatePath('/test');
    revalidateTag('github-releases');
    return { success: true, message: t('toast_setup_test_repo_success') };
  } catch (error: any) {
    console.error('setupTestRepositoryAction failed:', error);
    return { success: false, message: error.message || t('toast_setup_test_repo_error') };
  }
}

export async function triggerReleaseCheckAction(): Promise<{ success: boolean; message: string; }> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'TestPage'});

  const {MAIL_HOST, MAIL_PORT, MAIL_FROM_ADDRESS, MAIL_TO_ADDRESS, APPRISE_URL} = process.env;
  const isSmtpConfigured = !!(MAIL_HOST && MAIL_PORT && MAIL_FROM_ADDRESS && MAIL_TO_ADDRESS);
  const isAppriseConfigured = !!APPRISE_URL;

  if (!isSmtpConfigured && !isAppriseConfigured) {
    return {
      success: false,
      message: t('toast_no_notification_service_configured'),
    };
  }

  try {
    const result = await checkForNewReleases({ overrideLocale: locale, skipCache: true });

    if (result && result.notificationsSent > 0) {
      return { success: true, message: t('toast_trigger_check_success_email_sent') };
    } else {
      return { success: true, message: t('toast_trigger_check_success_no_email') };
    }
  } catch (error: any) {
    console.error('triggerReleaseCheckAction failed:', error);
    return { success: false, message: error.message || t('toast_trigger_check_error') };
  }
}

export async function getGitHubRateLimit(): Promise<RateLimitResult> {
  const GITHUB_API_URL = 'https://api.github.com/rate_limit';
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GitHubReleaseMonitorApp',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_ACCESS_TOKEN}`;
  }

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error(
        `GitHub API error for rate_limit: ${response.status} ${response.statusText}`
      );
      if (response.status === 401) {
        return {data: null, error: 'invalid_token'};
      }
      return {data: null, error: 'api_error'};
    }
    const data = await response.json();
    return {data, error: undefined};
  } catch (error) {
    console.error('Failed to fetch GitHub rate limit:', error);
    return {data: null, error: 'api_error'};
  }
}

export async function sendTestEmailAction(customEmail: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'TestPage'});
  const tEmail = await getTranslations({locale, namespace: 'Email'});

  const trimmedEmail = customEmail.trim();
  const recipient = trimmedEmail || process.env.MAIL_TO_ADDRESS;

  const {MAIL_HOST, MAIL_PORT, MAIL_FROM_ADDRESS} =
    process.env;
  if (!MAIL_HOST || !MAIL_PORT || !MAIL_FROM_ADDRESS || !recipient) {
    return {
      success: false,
      error: tEmail('error_config_incomplete'),
    };
  }

  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return {
      success: false,
      error: t('invalid_email_format'),
    };
  }


  const testRepo: Repository = {
    id: 'test/test',
    url: 'https://github.com/test/test',
  };

  const { title, body } = await getComprehensiveMarkdownBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: 'https://github.com/test/test/releases/tag/v1.0.0',
    tag_name: 'v1.0.0-test',
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestEmail(testRepo, testRelease, locale, settings.timeFormat, recipient);
    return {success: true};
  } catch (error: any) {
    console.error('sendTestEmailAction failed:', error);
    return {
      success: false,
      error: error.message || t('toast_email_error_description'),
    };
  }
}

export async function sendTestAppriseAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'TestPage'});

  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
      return {
          success: false,
          error: t('toast_apprise_not_configured_error'),
      };
  }

  const testRepo: Repository = {
    id: 'test/test',
    url: 'https://github.com/test/test',
  };

  const { title, body } = await getBasicAppriseTestBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: 'https://github.com/test/test/releases/tag/v1.0.0',
    tag_name: 'v1.0.0-test',
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestAppriseNotification(testRepo, testRelease, locale, settings);
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkAppriseStatusAction(): Promise<AppriseStatus> {
  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    return { status: 'not_configured' };
  }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'TestPage' });

  try {
    const urlObject = new URL(APPRISE_URL);
    const statusUrl = `${urlObject.protocol}//${urlObject.host}/status`;

    const response = await fetch(statusUrl, {
      headers: {
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (response.ok) {
      return { status: 'ok' };
    } else {
      return {
        status: 'error',
        error: t('apprise_connection_error_status', {status: response.status}),
      };
    }
  } catch (error) {
    return {
      status: 'error',
      error: t('apprise_connection_error_fetch')
    };
  }
}


export async function refreshAndCheckAction(): Promise<{
  success: boolean;
  messageKey: 'toast_refresh_success_description' | 'toast_refresh_found_new';
}> {
  const locale = await getLocale();
  const result = await checkForNewReleases({ overrideLocale: locale, skipCache: true });

  const messageKey = result.notificationsSent > 0 ? 'toast_refresh_found_new' : 'toast_refresh_success_description';

  return { success: true, messageKey };
}

export async function getRepositoriesForExport(): Promise<{ success: boolean; data?: Repository[]; error?: string; }> {
  try {
    const repos = await getRepositories();
    return { success: true, data: repos };
  } catch (error: any) {
    console.error("Failed to get repositories for export:", error);
    return { success: false, error: 'Failed to read repository data.' };
  }
}

export async function updateRepositorySettingsAction(
  repoId: string,
  settings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'appriseTags' | 'appriseFormat'>
): Promise<{ success: boolean; error?: string }> {
  if (!isValidRepoId(repoId)) {
    return { success: false, error: 'Invalid repository ID format.' };
  }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'RepoSettingsDialog' });

  try {
    const currentRepos = await getRepositories();
    const repoIndex = currentRepos.findIndex(r => r.id === repoId);

    if (repoIndex === -1) {
      return { success: false, error: t('toast_error_not_found') };
    }

    currentRepos[repoIndex] = {
      ...currentRepos[repoIndex],
      releaseChannels: settings.releaseChannels,
      preReleaseSubChannels: settings.preReleaseSubChannels,
      releasesPerPage: settings.releasesPerPage,
      includeRegex: settings.includeRegex,
      excludeRegex: settings.excludeRegex,
      appriseTags: settings.appriseTags,
      appriseFormat: settings.appriseFormat,
    };

    await saveRepositories(currentRepos);
    return { success: true };

  } catch (error: any)
  {
    console.error(`Failed to update settings for ${repoId}:`, error);
    return { success: false, error: error.message || t('toast_error_generic') };
  }
}

export async function revalidateReleasesAction() {
  revalidateTag('github-releases');
}

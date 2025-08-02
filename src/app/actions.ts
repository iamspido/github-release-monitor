
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

async function getBasicMarkdownBodyForApprise(locale: string): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: 'TestRelease' });

  const body = `**${t('apprise_basic_test_title')}**
  
  - ${t('apprise_basic_item_bold')}
  - ${t('apprise_basic_item_italic')}
  - \`${t('apprise_basic_item_code')}\`
  
  > ${t('apprise_basic_blockquote')}
  
  [${t('apprise_basic_link_text')}](https://github.com/iamspido/github-release-monitor)`;

  return {
    title: t('apprise_basic_test_notification_title'),
    body: body,
  };
}


async function fetchLatestRelease(
  owner: string,
  repo: string,
  repoSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex'>,
  globalSettings: AppSettings,
  locale: string
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  const fetchedAtTimestamp = new Date().toISOString();

  // --- Determine effective settings ---
  const effectiveReleaseChannels = (repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0)
    ? repoSettings.releaseChannels
    : globalSettings.releaseChannels;
  
  const effectivePreReleaseSubChannels = (repoSettings.preReleaseSubChannels && repoSettings.preReleaseSubChannels.length > 0)
    ? repoSettings.preReleaseSubChannels
    : globalSettings.preReleaseSubChannels || allPreReleaseTypes;

  const releasesToFetch = (typeof repoSettings.releasesPerPage === 'number' && repoSettings.releasesPerPage >= 1 && repoSettings.releasesPerPage <= 100)
    ? repoSettings.releasesPerPage
    : globalSettings.releasesPerPage;
  
  // Regex settings: repository settings override global settings.
  const effectiveIncludeRegex = repoSettings.includeRegex ?? globalSettings.includeRegex;
  const effectiveExcludeRegex = repoSettings.excludeRegex ?? globalSettings.excludeRegex;
  // ---

  const GITHUB_API_URL = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${releasesToFetch}`;

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
  // --- End of special handling ---

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GitHubReleaseMonitorApp',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_ACCESS_TOKEN}`;
  }

  const fetchOptions: RequestInit = { headers, cache: 'no-store' };

  try {
    const response = await fetch(GITHUB_API_URL, fetchOptions);

    if (!response.ok) {
        if (response.status === 404) {
            console.error(`GitHub API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`);
            return { release: null, error: { type: 'repo_not_found' } };
        }
        if (response.status === 403) {
            console.error('GitHub API rate limit likely exceeded. Please add a GITHUB_ACCESS_TOKEN to your .env file.');
            return { release: null, error: { type: 'rate_limit' } };
        }
        console.error(`GitHub API error for ${owner}/${repo}: ${response.status} ${response.statusText}`);
        return { release: null, error: { type: 'api_error' } };
    }

    const releases: GithubRelease[] = await response.json();
    if (releases.length === 0) {
      // The API returned an empty array, which means the repo exists but has no releases at all.
      return { release: null, error: { type: 'no_releases_found' } };
    }

    const filteredReleases = releases.filter(r => {
      // --- New Regex Filtering Logic ---
      try {
        // 1. Exclude filter has highest priority. If tag matches, it's always excluded.
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, 'i');
          if (exclude.test(r.tag_name)) {
            return false;
          }
        }
        // 2. If include filter is present, tag MUST match it. This overrides channel filters.
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, 'i');
          return include.test(r.tag_name);
        }
      } catch (e) {
        console.error(`Invalid regex for repo ${owner}/${repo}. Regex filters will be ignored. Error:`, e);
        // If regex is invalid, we ignore it and proceed to channel filtering.
      }
      // --- End of Regex Filtering ---

      // --- Original Channel Filtering Logic (runs if no includeRegex is active) ---
      // Rule 1: Handle Drafts first, as they are a distinct category.
      if (r.draft) {
        return effectiveReleaseChannels.includes('draft');
      }

      // At this point, r.draft is false.
      
      // Rule 2: Determine if the release is fundamentally a pre-release.
      // A release is considered a pre-release if GitHub says so OR if its tag matches any known pre-release identifier.
      const isConsideredPreRelease = r.prerelease || isPreReleaseByTagName(r.tag_name, allPreReleaseTypes);
      
      if (isConsideredPreRelease) {
        // It's a pre-release.
        // It's only included if the user wants pre-releases AND it matches their specific sub-channel selection.
        if (!effectiveReleaseChannels.includes('prerelease')) {
          return false; // User doesn't want any pre-releases.
        }
        // User wants pre-releases, now check if THIS one matches their sub-filter.
        // The check uses the user's selected sub-channels.
        return isPreReleaseByTagName(r.tag_name, effectivePreReleaseSubChannels);
      } else {
        // It's not a pre-release, so it's classified as stable.
        // It's included only if the user wants stable releases.
        return effectiveReleaseChannels.includes('stable');
      }
    });

    if (filteredReleases.length === 0) {
      // We fetched releases, but none matched the user's filters.
      return { release: null, error: { type: 'no_matching_releases' } };
    }

    let latestRelease = filteredReleases[0];

    if (!latestRelease.body || latestRelease.body.trim() === '') {
        console.log(`Release body for ${owner}/${repo} tag ${latestRelease.tag_name} is empty. Attempting to fetch commit message.`);
        
        const commitApiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${latestRelease.tag_name}`;
        
        try {
            const commitResponse = await fetch(commitApiUrl, {
                headers,
                // The cache options from the main request should apply here too
                ...fetchOptions,
            });

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
    
    return { release: latestRelease, error: null };
    
  } catch (error) {
    console.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: 'api_error' } };
  }
}

async function fetchLatestReleaseWithCache(
  owner: string,
  repo: string,
  repoSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex'>,
  globalSettings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean }
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  // If cache is disabled in settings OR if explicitly skipped, fetch directly.
  if (globalSettings.cacheInterval <= 0 || options?.skipCache) {
    return fetchLatestRelease(owner, repo, repoSettings, globalSettings, locale);
  }

  const cacheIntervalSeconds = globalSettings.cacheInterval * 60;

  // Determine the effective releasesPerPage for the cache key
  const effectiveReleasesPerPage = (typeof repoSettings.releasesPerPage === 'number' && repoSettings.releasesPerPage >= 1 && repoSettings.releasesPerPage <= 100)
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
  const t = await getTranslations({locale, namespace: 'Actions'});

  const releasePromises = repositories.map(
    async (repo): Promise<EnrichedRelease> => {
      const parsed = parseGitHubUrl(repo.url);
      if (!parsed) {
        return {
          repoId: repo.id,
          repoUrl: repo.url,
          error: { type: 'invalid_url' },
          isNew: repo.isNew,
        };
      }

      const repoSettings = {
        releaseChannels: repo.releaseChannels,
        preReleaseSubChannels: repo.preReleaseSubChannels,
        releasesPerPage: repo.releasesPerPage,
        includeRegex: repo.includeRegex,
        excludeRegex: repo.excludeRegex,
        appriseTags: repo.appriseTags,
      };

      const { release: latestRelease, error } = await fetchLatestReleaseWithCache(
        parsed.owner,
        parsed.repo,
        repoSettings,
        settings,
        locale,
        options // Pass options down
      );

      if (error) {
        return {
          repoId: repo.id,
          repoUrl: repo.url,
          error: error,
          isNew: repo.isNew,
          repoSettings: repoSettings,
        };
      }

      if (!latestRelease) {
        // This case should ideally not be reached if fetchLatestRelease always returns an error object,
        // but it's a safe fallback.
        return {
          repoId: repo.id,
          repoUrl: repo.url,
          error: { type: 'api_error' },
          isNew: repo.isNew,
          repoSettings: repoSettings,
        };
      }

      return {
        repoId: repo.id,
        repoUrl: repo.url,
        release: latestRelease,
        isNew: repo.isNew,
        repoSettings: repoSettings,
      };
    }
  );

  return Promise.all(releasePromises);
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
    // Security: Do not leak raw error messages to the client
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
        ...currentReposMap.get(importedRepo.id), // Preserve existing unknown fields
        id: importedRepo.id,
        url: importedRepo.url,
        lastSeenReleaseTag: importedRepo.lastSeenReleaseTag,
        isNew: (settings.showAcknowledge ?? true) ? (importedRepo.isNew ?? false) : false,
        releaseChannels: importedRepo.releaseChannels,
        preReleaseSubChannels: importedRepo.preReleaseSubChannels,
        releasesPerPage: importedRepo.releasesPerPage,
        includeRegex: importedRepo.includeRegex,
        excludeRegex: importedRepo.excludeRegex,
        appriseTags: importedRepo.appriseTags,
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
  // Security: Validate input
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
  // Security: Validate input
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
  // Security: Validate input
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

  const repos = await getRepositories();
  if (repos.length === 0) {
    console.log('No repositories to check.');
    return { notificationsSent: 0, checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    repos, 
    settings, 
    effectiveLocale, 
    { skipCache: options?.skipCache }
  );

  let updatedRepos = [...repos];
  let changed = false;
  let notificationsSent = 0;

  for (const enrichedRelease of enrichedReleases) {
    if (enrichedRelease.release) {
      const repoIndex = updatedRepos.findIndex(
        r => r.id === enrichedRelease.repoId
      );
      if (repoIndex !== -1) {
        const repo = updatedRepos[repoIndex];
        const newTag = enrichedRelease.release.tag_name;
        const isNewRelease = repo.lastSeenReleaseTag && repo.lastSeenReleaseTag !== newTag;

        if (isNewRelease) {
          console.log(
            `New release detected for ${repo.id}: ${newTag} (previously ${repo.lastSeenReleaseTag})`
          );
          
          const shouldHighlight = settings.showAcknowledge ?? true;
          // Always update tag and 'isNew' status, regardless of notification success
          updatedRepos[repoIndex] = {...repo, lastSeenReleaseTag: newTag, isNew: shouldHighlight};
          changed = true;
          
          try {
              await sendNotification(repo, enrichedRelease.release, effectiveLocale, settings);
              notificationsSent++;
          } catch(e: any) {
            // If sending fails, we log the error but DO NOT revert the tag update.
            // The notification failure should not block the app from recognizing future releases.
            console.error(`Failed to send notification for ${repo.id}. The release tag HAS been updated to prevent repeated failures for the same release. Error: ${e.message}`);
          }
        } else if (!repo.lastSeenReleaseTag) {
          console.log(
            `First fetch for ${repo.id}, setting initial release tag to ${newTag}. No notification will be sent.`
          );
          updatedRepos[repoIndex] = {...repo, lastSeenReleaseTag: newTag, isNew: false};
          changed = true;
        }
      }
    }
  }

  if (changed) {
    console.log('Found changes, updating repository data file.');
    await saveRepositories(updatedRepos);
  } else {
    console.log('No new releases found.');
  }
   return { notificationsSent, checked: repos.length };
}


// --- Dynamic Background Polling ---

async function backgroundPollingLoop() {
  try {
    // Explicitly tell the check to skip caching
    await checkForNewReleases({ skipCache: true });
  } catch (error) {
    console.error("Error during background check for new releases:", error);
  } finally {
    // Schedule the next run, regardless of success or failure.
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

// This block sets up the background polling.
// It's designed for a long-running server environment like Docker.
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.BACKGROUND_POLLING_INITIALIZED
) {
  console.log("Initializing dynamic background polling.");
  // Mark as initialized to prevent multiple loops in development hot-reloading.
  process.env.BACKGROUND_POLLING_INITIALIZED = 'true';
  // Start the first check after a short delay to allow the server to boot.
  setTimeout(backgroundPollingLoop, 5000);
}


// --- Test Page Actions ---

const TEST_REPO_ID = 'test/test';

export async function setupTestRepositoryAction(): Promise<{ success: boolean; message: string; }> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'TestPage'});
  
  try {
    const currentRepos = await getRepositories();
    const testRepoIndex = currentRepos.findIndex(r => r.id === TEST_REPO_ID);
    
    if (testRepoIndex > -1) {
      // If it exists, reset its tag to an "old" version
      currentRepos[testRepoIndex].lastSeenReleaseTag = 'v0.9.0-reset';
      currentRepos[testRepoIndex].isNew = false;
    } else {
      // If it doesn't exist, add it with an "old" version tag
      currentRepos.push({
        id: TEST_REPO_ID,
        url: `https://github.com/${TEST_REPO_ID}`,
        lastSeenReleaseTag: 'v0.9.0-initial',
        isNew: false,
      });
    }

    await saveRepositories(currentRepos);
    revalidatePath('/'); // To show the repo on the main page
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
  
  // At least one notification service must be configured
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
    // Pass the current user's locale to the check function and skip cache
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
      cache: 'no-store', // Always get the latest rate limit
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

  // Check if mail is configured
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
  
  const { title, body } = await getBasicMarkdownBodyForApprise(locale);
  
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
    // We log the detailed error in sendAppriseNotification. Here, we pass it up.
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
    // The base URL for the status check is derived by removing any path from the provided URL.
    // This allows the user to provide http://host/notify/key while we still check http://host/status.
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
  settings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'appriseTags'>
): Promise<{ success: boolean; error?: string }> {
  // Security: Validate input
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

    // Update the settings for the specific repository
    currentRepos[repoIndex] = {
      ...currentRepos[repoIndex],
      releaseChannels: settings.releaseChannels,
      preReleaseSubChannels: settings.preReleaseSubChannels,
      releasesPerPage: settings.releasesPerPage,
      includeRegex: settings.includeRegex,
      excludeRegex: settings.excludeRegex,
      appriseTags: settings.appriseTags,
    };

    await saveRepositories(currentRepos);
    return { success: true };

  } catch (error: any) {
    console.error(`Failed to update settings for ${repoId}:`, error);
    return { success: false, error: error.message || t('toast_error_generic') };
  }
}

export async function revalidateReleasesAction() {
  revalidateTag('github-releases');
}

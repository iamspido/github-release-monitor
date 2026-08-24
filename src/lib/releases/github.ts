import { getTranslations } from "next-intl/server";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { getComprehensiveMarkdownBody } from "@/lib/notifications/test-release-payloads";
import {
  applyVerifiedCommitLinks,
  canReuseCommitLinkState,
  inheritCommitLinkState,
} from "@/lib/releases/commit-links";
import {
  fetchJsonResponseWithRetry,
  fetchWithRetry,
} from "@/lib/releases/fetch";
import {
  isCachedTagFallbackRelease,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import {
  extractGithubReleaseBodyHtml,
  resolveGithubCommitLinks,
} from "@/lib/releases/github-markdown";
import { parseGithubTagsPage } from "@/lib/releases/github-tags-page";
import {
  buildFallbackMarkdown,
  notModifiedResult,
  releaseErrorResult,
  releaseSuccessResult,
  resolvePageCount,
  resolvePageSize,
  resolveReleaseSelectionErrorType,
  selectLatestMatchingRelease,
} from "@/lib/releases/provider-pipeline";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type { AppSettings, FetchError, GithubRelease, Locale } from "@/types";

type GithubTagCandidate = {
  tag: { name: string; commit: { sha: string } };
  release: GithubRelease;
};

type GithubReleasePage = {
  finalUrl: string;
  html: string;
};

function getCanonicalGithubRepository(
  githubUrl: string,
  fallback: { owner: string; repo: string },
  expectedSection: "commit" | "releases" | "tags" = "releases",
): { owner: string; repo: string } {
  try {
    const url = new URL(githubUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      segments.length >= 3 &&
      segments[2] === expectedSection
    ) {
      return {
        owner: decodeURIComponent(segments[0]),
        repo: decodeURIComponent(segments[1]),
      };
    }
  } catch {
    // Fall back to the configured repository when the release URL is invalid.
  }
  return fallback;
}

function getCanonicalGithubApiRepository(
  apiUrl: string,
  fallback: { owner: string; repo: string },
): { owner: string; repo: string } {
  try {
    const url = new URL(apiUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol === "https:" &&
      url.hostname === "api.github.com" &&
      segments.length >= 4 &&
      segments[0] === "repos"
    ) {
      return {
        owner: decodeURIComponent(segments[1]),
        repo: decodeURIComponent(segments[2]),
      };
    }
  } catch {
    // Fall back to the configured repository when the API URL is invalid.
  }
  return fallback;
}

async function fetchGithubReleasePageHtml(
  releaseUrl: string,
  owner: string,
  repo: string,
  timeoutMs: number,
): Promise<GithubReleasePage | null> {
  try {
    const response = await fetchWithRetry(
      releaseUrl,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": "GitHubReleaseMonitorApp",
        },
        cache: "no-store",
      },
      {
        description: `GitHub release page for ${owner}/${repo}`,
        allowedRedirectBaseUrl: "https://github.com",
        maxAttempts: 1,
        timeoutMs,
      },
    );
    if (!response.ok) {
      await discardResponseWithTimeout(response);
      return null;
    }
    const finalUrl = response.url || releaseUrl;
    const html = await consumeResponseWithTimeout(response, (result) =>
      result.text(),
    );
    return { finalUrl, html };
  } catch (error) {
    log.warn(`Could not render release page for ${owner}/${repo}.`, error);
    return null;
  }
}

function extractExpectedGithubReleaseBody(
  page: GithubReleasePage,
  releaseUrl: string,
): string | null {
  try {
    const expectedUrl = new URL(releaseUrl);
    const finalUrl = new URL(page.finalUrl);
    if (
      finalUrl.origin !== expectedUrl.origin ||
      finalUrl.pathname.replace(/\/+$/, "") !==
        expectedUrl.pathname.replace(/\/+$/, "")
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return extractGithubReleaseBodyHtml(page.html);
}

async function fetchGithubMarkdownHtml(args: {
  body: string;
  headers: Record<string, string>;
  owner: string;
  repo: string;
  timeoutMs: number;
}): Promise<string | null> {
  try {
    const response = await fetchWithRetry(
      "https://api.github.com/markdown",
      {
        method: "POST",
        headers: {
          ...args.headers,
          Accept: "text/html",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: args.body,
          mode: "gfm",
          context: `${args.owner}/${args.repo}`,
        }),
        cache: "no-store",
      },
      {
        description: `GitHub Markdown for ${args.owner}/${args.repo}`,
        maxAttempts: 1,
        timeoutMs: args.timeoutMs,
      },
    );
    if (!response.ok) {
      await discardResponseWithTimeout(response);
      return null;
    }
    return consumeResponseWithTimeout(response, (result) => result.text());
  } catch (error) {
    log.warn(
      `Could not resolve GitHub commit references for ${args.owner}/${args.repo}.`,
      error,
    );
    return null;
  }
}

async function applyGithubCommitLinks(args: {
  bodyIsProviderRendered: boolean;
  headers: Record<string, string>;
  release: GithubRelease;
  owner: string;
  repo: string;
}): Promise<void> {
  const { release } = args;
  const canonicalRepository = getCanonicalGithubRepository(release.html_url, {
    owner: args.owner,
    repo: args.repo,
  });
  await applyVerifiedCommitLinks({
    release,
    resolve: async (_candidates, deadline) => {
      if (args.bodyIsProviderRendered) {
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) return null;
        const releasePage = await fetchGithubReleasePageHtml(
          release.html_url,
          canonicalRepository.owner,
          canonicalRepository.repo,
          timeoutMs,
        );
        const releaseBodyHtml = releasePage
          ? extractExpectedGithubReleaseBody(releasePage, release.html_url)
          : null;
        if (releaseBodyHtml !== null) {
          return {
            links: resolveGithubCommitLinks(
              release.body ?? "",
              releaseBodyHtml,
              canonicalRepository.owner,
              canonicalRepository.repo,
            ),
            checkedRefs: [..._candidates],
            complete: true,
          };
        }
      }

      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) return null;
      const renderedHtml = await fetchGithubMarkdownHtml({
        body: release.body ?? "",
        headers: args.headers,
        owner: canonicalRepository.owner,
        repo: canonicalRepository.repo,
        timeoutMs,
      });
      return renderedHtml === null
        ? null
        : {
            links: resolveGithubCommitLinks(
              release.body ?? "",
              renderedHtml,
              canonicalRepository.owner,
              canonicalRepository.repo,
            ),
            checkedRefs: [..._candidates],
            complete: true,
          };
    },
  });
}

async function fetchGithubProviderLatestRelease(
  apiBaseUrl: string,
  headers: Record<string, string>,
  owner: string,
  repo: string,
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  const { response, data } = await fetchJsonResponseWithRetry<GithubRelease>(
    `${apiBaseUrl}/releases/latest`,
    { headers, cache: "no-store" },
    { description: `GitHub provider-latest release for ${owner}/${repo}` },
  );

  if (!response.ok) {
    await discardResponseWithTimeout(response);
    if (response.status === 404) {
      return { release: null, error: null };
    }
    const error: FetchError = {
      type:
        response.status === 403 || response.status === 429
          ? "rate_limit"
          : "api_error",
    };
    log.warn(
      `GitHub provider-latest endpoint failed for ${owner}/${repo}: ${response.status} ${response.statusText}`,
    );
    return { release: null, error };
  }

  return { release: data ?? null, error: null };
}

function selectGithubTagCandidate(args: {
  candidates: GithubTagCandidate[];
  filters: ReturnType<typeof resolveEffectiveRepoFilters>;
  repoIdForLog: string;
}): GithubTagCandidate | null {
  const selectedRelease = selectLatestMatchingRelease({
    releases: args.candidates.map(({ release }) => release),
    filters: args.filters,
    repoIdForLog: args.repoIdForLog,
    strategy: args.filters.effectiveReleaseSelectionStrategy,
  });

  return (
    args.candidates.find(({ release }) => release === selectedRelease) ?? null
  );
}

async function fetchGithubTagCandidatesFromPage(args: {
  owner: string;
  repo: string;
  filters: ReturnType<typeof resolveEffectiveRepoFilters>;
}): Promise<GithubTagCandidate[]> {
  try {
    const response = await fetchWithRetry(
      `https://github.com/${args.owner}/${args.repo}/tags`,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": "GitHubReleaseMonitorApp",
        },
        cache: "no-store",
      },
      {
        description: `GitHub tags page for ${args.owner}/${args.repo}`,
      },
    );

    if (!response.ok) {
      await discardResponseWithTimeout(response);
      return [];
    }

    const body = await consumeResponseWithTimeout(response, (result) =>
      result.text(),
    );
    const canonicalRepository = getCanonicalGithubRepository(
      response.url,
      { owner: args.owner, repo: args.repo },
      "tags",
    );
    const entries = parseGithubTagsPage(body).slice(
      0,
      args.filters.totalReleasesToFetch,
    );
    const candidates: GithubTagCandidate[] = entries.map((entry) => ({
      tag: { name: entry.name, commit: { sha: entry.commitSha } },
      release: {
        id: 0,
        html_url: `https://github.com/${canonicalRepository.owner}/${canonicalRepository.repo}/releases/tag/${encodeURIComponent(entry.name)}`,
        tag_name: entry.name,
        name: `Tag: ${entry.name}`,
        body: "",
        created_at: entry.updatedAt,
        published_at: entry.updatedAt,
        prerelease: false,
        draft: false,
      },
    }));

    return candidates;
  } catch (error) {
    log.warn(
      `Could not use the chronological GitHub tags page for ${args.owner}/${args.repo}; falling back to the REST tags endpoint.`,
      error,
    );
    return [];
  }
}

function mergeGithubTagCandidates(
  preferred: GithubTagCandidate[],
  additional: GithubTagCandidate[],
  limit: number,
): GithubTagCandidate[] {
  const seenTagNames = new Set<string>();
  const merged: GithubTagCandidate[] = [];

  for (const candidate of [...preferred, ...additional]) {
    if (seenTagNames.has(candidate.tag.name)) continue;
    seenTagNames.add(candidate.tag.name);
    merged.push(candidate);
    if (merged.length >= limit) break;
  }

  return merged;
}

export async function fetchLatestReleaseFromGitHub(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: Locale,
): Promise<LatestReleaseFetchResult> {
  log.info(`Fetching GitHub release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const filters = resolveEffectiveRepoFilters(repoSettings, globalSettings);
  const { effectiveReleaseSelectionStrategy, totalReleasesToFetch } = filters;

  // --- Special handling for the virtual test repository ---
  if (owner === "test" && repo === "test") {
    const { title, body } = await getComprehensiveMarkdownBody(locale);
    const release = {
      id: 1,
      html_url: "https://github.com/test/test/releases/tag/v1.0.0-simulated",
      tag_name: "v1.0.0-simulated",
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
  const pagesToFetch = resolvePageCount(totalReleasesToFetch, MAX_PER_PAGE);
  const releasePagesToFetch =
    effectiveReleaseSelectionStrategy === "provider_latest" ? 1 : pagesToFetch;
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;
  let providerLatestRelease: GithubRelease | null | undefined;
  let selectedReleaseFromTagScan: GithubRelease | undefined;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitHubReleaseMonitorApp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const githubToken = normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN);
  if (githubToken) {
    headers.Authorization = `token ${githubToken}`;
  }

  try {
    if (effectiveReleaseSelectionStrategy === "provider_latest") {
      const providerLatestResult = await fetchGithubProviderLatestRelease(
        GITHUB_API_BASE_URL,
        headers,
        owner,
        repo,
      );
      if (providerLatestResult.error) {
        return {
          release: null,
          error: providerLatestResult.error,
          newEtag,
        };
      }
      providerLatestRelease = providerLatestResult.release;
      if (providerLatestRelease) allReleases = [providerLatestRelease];
    }

    for (
      let page = 1;
      !providerLatestRelease && page <= releasePagesToFetch;
      page++
    ) {
      const releasesOnThisPage = resolvePageSize({
        maxPerPage: MAX_PER_PAGE,
        totalItemsToFetch: totalReleasesToFetch,
        alreadyFetched: allReleases.length,
      });
      if (releasesOnThisPage <= 0) break;

      const url = `${GITHUB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeaders = { ...headers };
      // A page-one releases ETag cannot validate candidates from later pages
      // or from the separate tags endpoint used by highest-version selection.
      // Uninitialized commit-link metadata needs a non-conditional response.
      // Failed enrichment attempts may reuse the ETag until their retry is due.
      if (
        page === 1 &&
        releasePagesToFetch === 1 &&
        effectiveReleaseSelectionStrategy === "newest" &&
        repoSettings.etag &&
        repoSettings.latestRelease &&
        canReuseCommitLinkState(repoSettings.latestRelease) &&
        !isCachedTagFallbackRelease(repoSettings.latestRelease)
      ) {
        currentHeaders["If-None-Match"] = repoSettings.etag;
      }
      const fetchOptions: RequestInit = {
        headers: currentHeaders,
        cache: "no-store",
      };

      const { response, data: pageReleases } = await fetchJsonResponseWithRetry<
        GithubRelease[]
      >(url, fetchOptions, {
        description: `GitHub releases for ${owner}/${repo} page ${page}`,
      });

      // For the first page, check for 304 Not Modified.
      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          await discardResponseWithTimeout(response);
          return notModifiedResult(`${owner}/${repo}`, repoSettings.etag);
        }
      }

      if (!response.ok) {
        await discardResponseWithTimeout(response);
        if (response.status === 404) {
          log.error(
            `GitHub API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`,
          );
          return { release: null, error: { type: "repo_not_found" }, newEtag };
        }
        if (response.status === 403) {
          const rateLimitLimit = response.headers.get("x-ratelimit-limit");
          const rateLimitRemaining = response.headers.get(
            "x-ratelimit-remaining",
          );
          const rateLimitReset = response.headers.get("x-ratelimit-reset");
          const resetTime = rateLimitReset
            ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString()
            : "N/A";

          log.error(
            `GitHub API rate limit exceeded for ${owner}/${repo}. ` +
              `Limit: ${rateLimitLimit}, Remaining: ${rateLimitRemaining}, Resets at: ${resetTime}. ` +
              "Please add or check your GITHUB_ACCESS_TOKEN.",
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }
        log.error(
          `GitHub API error for ${owner}/${repo}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `GitHub API returned an empty body for ${owner}/${repo} releases page ${page}.`,
        );
      }

      allReleases = [...allReleases, ...pageReleases];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    const shouldInspectTags =
      effectiveReleaseSelectionStrategy !== "provider_latest" &&
      (allReleases.length === 0 ||
        effectiveReleaseSelectionStrategy === "highest_version");

    if (shouldInspectTags) {
      const hasFormalReleases = allReleases.length > 0;
      log.info(
        hasFormalReleases
          ? `Inspecting additional tags for highest-version selection in ${owner}/${repo}.`
          : `No formal releases found for ${owner}/${repo}. Falling back to tags.`,
      );
      newEtag = null;
      let releasesForSelection = [...allReleases];

      // GitHub's REST tag order is not chronological for every repository.
      // Keep the dated candidates from the tags page as an activity signal,
      // then merge them with the wider REST result for semantic comparison.
      const chronologicalTagCandidates = await fetchGithubTagCandidatesFromPage(
        {
          owner,
          repo,
          filters,
        },
      );
      let selectedCandidate =
        effectiveReleaseSelectionStrategy === "highest_version"
          ? null
          : selectGithubTagCandidate({
              candidates: chronologicalTagCandidates,
              filters,
              repoIdForLog: `${owner}/${repo}`,
            });

      if (!selectedCandidate) {
        const allTags: { name: string; commit: { sha: string } }[] = [];
        let restTagsRepository = { owner, repo };
        let tagsFetchErrorType: FetchError["type"] | null = null;
        for (let page = 1; page <= pagesToFetch; page++) {
          const tagsOnThisPage = resolvePageSize({
            maxPerPage: MAX_PER_PAGE,
            totalItemsToFetch: totalReleasesToFetch,
            alreadyFetched: allTags.length,
          });
          if (tagsOnThisPage <= 0) break;

          const { response: tagsResponse, data: pageTags } =
            await fetchJsonResponseWithRetry<
              { name: string; commit: { sha: string } }[]
            >(
              `${GITHUB_API_BASE_URL}/tags?per_page=${tagsOnThisPage}&page=${page}`,
              { headers, cache: "no-store" },
              { description: `GitHub tags for ${owner}/${repo} page ${page}` },
            );

          restTagsRepository = getCanonicalGithubApiRepository(
            tagsResponse.url,
            restTagsRepository,
          );

          if (!tagsResponse.ok) {
            await discardResponseWithTimeout(tagsResponse);
            log.error(
              `Failed to fetch tags for ${owner}/${repo} while resolving release candidates.`,
            );
            const errorType: FetchError["type"] =
              tagsResponse.status === 403 || tagsResponse.status === 429
                ? "rate_limit"
                : tagsResponse.status === 404
                  ? "repo_not_found"
                  : "api_error";
            tagsFetchErrorType = errorType;
            break;
          }

          if (!pageTags) {
            throw new Error(
              `GitHub API returned an empty body for ${owner}/${repo} tags page ${page}.`,
            );
          }

          allTags.push(...pageTags);

          if (pageTags.length < tagsOnThisPage) {
            break;
          }
        }

        if (allTags.length === 0 && chronologicalTagCandidates.length === 0) {
          if (tagsFetchErrorType) {
            return {
              release: null,
              error: { type: tagsFetchErrorType },
              newEtag,
            };
          }
          if (!hasFormalReleases) {
            log.info(`No tags found for ${owner}/${repo}.`);
            return {
              release: null,
              error: { type: "no_releases_found" },
              newEtag,
            };
          }
        }

        const tagCandidates: GithubTagCandidate[] = allTags.map((tag) => ({
          tag,
          release: {
            id: 0,
            html_url: `https://github.com/${restTagsRepository.owner}/${restTagsRepository.repo}/releases/tag/${encodeURIComponent(tag.name)}`,
            tag_name: tag.name,
            name: `Tag: ${tag.name}`,
            body: "",
            created_at: fetchedAtTimestamp,
            published_at: fetchedAtTimestamp,
            published_at_unknown: true,
            prerelease: false,
            draft: false,
          },
        }));
        const allTagCandidates = mergeGithubTagCandidates(
          chronologicalTagCandidates,
          tagCandidates,
          totalReleasesToFetch,
        );

        if (
          tagsFetchErrorType &&
          allTagCandidates.length < totalReleasesToFetch
        ) {
          return {
            release: null,
            error: { type: tagsFetchErrorType },
            newEtag,
          };
        }

        if (effectiveReleaseSelectionStrategy === "highest_version") {
          const formalTagNames = new Set(
            allReleases.map((release) => release.tag_name),
          );
          const additionalTagCandidates = allTagCandidates.filter(
            ({ tag }) => !formalTagNames.has(tag.name),
          );
          releasesForSelection = [
            ...allReleases,
            ...additionalTagCandidates.map(({ release }) => release),
          ];
          const selectedRelease = selectLatestMatchingRelease({
            releases: releasesForSelection,
            filters,
            repoIdForLog: `${owner}/${repo}`,
            strategy: effectiveReleaseSelectionStrategy,
          });
          selectedCandidate =
            additionalTagCandidates.find(
              ({ release }) => release === selectedRelease,
            ) ?? null;
          if (selectedRelease && !selectedCandidate) {
            selectedReleaseFromTagScan = selectedRelease;
          }
        } else {
          releasesForSelection = allTagCandidates.map(({ release }) => release);
          selectedCandidate = selectGithubTagCandidate({
            candidates: allTagCandidates,
            filters,
            repoIdForLog: `${owner}/${repo}`,
          });
        }
      }

      allReleases = releasesForSelection;

      if (!selectedCandidate && !selectedReleaseFromTagScan) {
        log.info(
          `No tags found for ${owner}/${repo} matching the configured filters.`,
        );
        return {
          release: null,
          error: {
            type: resolveReleaseSelectionErrorType({
              releases: releasesForSelection,
              filters,
              strategy: effectiveReleaseSelectionStrategy,
            }),
          },
          newEtag,
        };
      }

      if (selectedCandidate) {
        const latestTag = selectedCandidate.tag;
        const t = await getTranslations({ locale, namespace: "Actions" });

        let bodyContent = "";
        let publicationDate =
          selectedCandidate.release.published_at ||
          selectedCandidate.release.created_at;
        let publicationDateUnknown =
          selectedCandidate.release.published_at_unknown === true;
        let tagFallbackRepository = getCanonicalGithubRepository(
          selectedCandidate.release.html_url,
          { owner, repo },
        );

        try {
          const { response: refResponse, data: refData } =
            await fetchJsonResponseWithRetry<{
              object: { type: string; sha: string; url: string };
            }>(
              `${GITHUB_API_BASE_URL}/git/ref/tags/${encodeURIComponent(latestTag.name)}`,
              { headers, cache: "no-store" },
              {
                description: `Git reference for ${owner}/${repo} tag ${latestTag.name}`,
              },
            );

          if (refResponse.ok && refData) {
            tagFallbackRepository = getCanonicalGithubApiRepository(
              refData.object.url,
              tagFallbackRepository,
            );
            // If it's an annotated tag, the object type is 'tag'.
            if (refData.object.type === "tag") {
              const { response: annotatedTagResponse, data: annotatedTagData } =
                await fetchJsonResponseWithRetry<{
                  message?: string;
                  tagger?: { date?: string };
                }>(
                  refData.object.url,
                  { headers, cache: "no-store" },
                  {
                    description: `Annotated tag for ${owner}/${repo} tag ${latestTag.name}`,
                  },
                );
              if (annotatedTagResponse.ok && annotatedTagData) {
                if (annotatedTagData.message) {
                  bodyContent = buildFallbackMarkdown(
                    t("tag_message_fallback_title"),
                    annotatedTagData.message,
                  );
                }
                if (annotatedTagData.tagger?.date) {
                  publicationDate = annotatedTagData.tagger.date;
                  publicationDateUnknown = false;
                }
              } else if (!annotatedTagResponse.ok) {
                await discardResponseWithTimeout(annotatedTagResponse);
              }
            }
          } else if (!refResponse.ok) {
            await discardResponseWithTimeout(refResponse);
          }

          // If no annotated tag message was found (either lightweight tag or error), fall back to commit message.
          if (!bodyContent) {
            const { response: commitResponse, data: commitData } =
              await fetchJsonResponseWithRetry<{
                commit: { message: string; committer: { date: string } };
                html_url?: string;
              }>(
                `${GITHUB_API_BASE_URL}/commits/${latestTag.commit.sha}`,
                { headers, cache: "no-store" },
                {
                  description: `GitHub commit ${latestTag.commit.sha} for ${owner}/${repo}`,
                },
              );
            if (commitResponse.ok && commitData) {
              tagFallbackRepository = getCanonicalGithubRepository(
                commitData.html_url ?? "",
                tagFallbackRepository,
                "commit",
              );
              bodyContent = buildFallbackMarkdown(
                t("commit_message_fallback_title"),
                commitData.commit.message,
              );
              publicationDate = commitData.commit.committer.date;
              publicationDateUnknown = false;
            } else {
              await discardResponseWithTimeout(commitResponse);
              log.error(
                `Failed to fetch commit for tag ${latestTag.name} in ${owner}/${repo}.`,
              );
              return {
                release: null,
                error: { type: "api_error" },
                newEtag,
              };
            }
          }
        } catch (e) {
          log.error(`Error during tag fallback for ${owner}/${repo}:`, e);
          return { release: null, error: { type: "api_error" }, newEtag };
        }

        const virtualRelease: GithubRelease = {
          ...selectedCandidate.release,
          html_url: `https://github.com/${tagFallbackRepository.owner}/${tagFallbackRepository.repo}/releases/tag/${encodeURIComponent(latestTag.name)}`,
          body: bodyContent,
          created_at: publicationDate,
          published_at: publicationDate,
          published_at_unknown: publicationDateUnknown,
        };
        selectedReleaseFromTagScan = virtualRelease;
      }
    }

    const latestRelease =
      selectedReleaseFromTagScan ??
      selectLatestMatchingRelease({
        releases: allReleases,
        filters,
        repoIdForLog: `${owner}/${repo}`,
        strategy: effectiveReleaseSelectionStrategy,
        providerLatestRelease,
        providerLatestIsStable: true,
      });

    if (!latestRelease) {
      return releaseErrorResult(
        resolveReleaseSelectionErrorType({
          releases: allReleases,
          filters,
          strategy: effectiveReleaseSelectionStrategy,
        }),
        null,
      );
    }

    let bodyIsProviderRendered = latestRelease.id !== 0;

    // This check is for formal releases that have an empty body.
    // The tag fallback already populates the body with a commit message.
    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      log.info(
        `Release body for ${owner}/${repo} tag ${latestRelease.tag_name} is empty. Attempting to fetch commit message.`,
      );
      const commitApiUrl = `${GITHUB_API_BASE_URL}/commits/${latestRelease.tag_name}`;
      try {
        const { response: commitResponse, data: commitData } =
          await fetchJsonResponseWithRetry<{
            commit?: { message?: string };
          }>(
            commitApiUrl,
            { headers, cache: "no-store" },
            {
              description: `GitHub commit for ${owner}/${repo} tag ${latestRelease.tag_name}`,
            },
          );
        if (commitResponse.ok && commitData?.commit?.message) {
          const t = await getTranslations({ locale, namespace: "Actions" });
          latestRelease.body = buildFallbackMarkdown(
            t("commit_message_fallback_title"),
            commitData.commit.message,
          );
          bodyIsProviderRendered = false;
          log.info(
            `Successfully fetched commit message for ${owner}/${repo} tag ${latestRelease.tag_name}.`,
          );
        } else if (commitResponse.ok) {
          log.info(
            `Commit message for ${owner}/${repo} tag ${latestRelease.tag_name} could not be retrieved from commit data.`,
          );
        } else {
          await discardResponseWithTimeout(commitResponse);
          log.error(
            `Failed to fetch commit for ${owner}/${repo} tag ${latestRelease.tag_name}: ${commitResponse.status} ${commitResponse.statusText}`,
          );
        }
      } catch (error) {
        log.error(
          `Error fetching commit for tag ${latestRelease.tag_name} in ${owner}/${repo}:`,
          error,
        );
      }
    }

    inheritCommitLinkState(latestRelease, repoSettings.latestRelease);
    await applyGithubCommitLinks({
      bodyIsProviderRendered,
      headers,
      release: latestRelease,
      owner,
      repo,
    });

    return releaseSuccessResult(
      latestRelease,
      newEtag,
      new Date().toISOString(),
    );
  } catch (error) {
    log.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" }, newEtag: null };
  }
}

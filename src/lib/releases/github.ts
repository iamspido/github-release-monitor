import { getTranslations } from "next-intl/server";
import { getComprehensiveMarkdownBody } from "@/lib/notifications/test-release-payloads";
import { fetchJsonResponseWithRetry } from "@/lib/releases/fetch";
import {
  isCachedTagFallbackRelease,
  releaseMatchesEffectiveFilters,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type { AppSettings, GithubRelease } from "@/types";

export async function fetchLatestReleaseFromGitHub(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  log.info(`Fetching GitHub release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

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
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;

  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitHubReleaseMonitorApp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const githubToken = normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN);
  if (githubToken) {
    headers.Authorization = `token ${githubToken}`;
  }

  try {
    for (let page = 1; page <= pagesToFetch; page++) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${GITHUB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeaders = { ...headers };
      // Only use ETag for the first page request.
      if (
        page === 1 &&
        repoSettings.etag &&
        repoSettings.latestRelease &&
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
          log.info(`[ETag] No changes for ${owner}/${repo}.`);
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
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

    if (allReleases.length === 0) {
      log.info(
        `No formal releases found for ${owner}/${repo}. Falling back to tags.`,
      );
      newEtag = null;

      const allTags: { name: string; commit: { sha: string } }[] = [];
      for (let page = 1; page <= pagesToFetch; page++) {
        const tagsOnThisPage = Math.min(
          MAX_PER_PAGE,
          totalReleasesToFetch - allTags.length,
        );
        if (tagsOnThisPage <= 0) break;

        const { response: tagsResponse, data: pageTags } =
          await fetchJsonResponseWithRetry<
            { name: string; commit: { sha: string } }[]
          >(
            `${GITHUB_API_BASE_URL}/tags?per_page=${tagsOnThisPage}&page=${page}`,
            { headers, cache: "no-store" },
            { description: `GitHub tags for ${owner}/${repo} page ${page}` },
          );

        if (!tagsResponse.ok) {
          log.error(
            `Failed to fetch tags for ${owner}/${repo} after failing to find releases.`,
          );
          return {
            release: null,
            error: { type: "no_releases_found" },
            newEtag,
          };
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

      if (allTags.length === 0) {
        log.info(`No tags found for ${owner}/${repo}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const tagCandidates = allTags.map((tag) => ({
        tag,
        release: {
          id: 0,
          html_url: `https://github.com/${owner}/${repo}/releases/tag/${tag.name}`,
          tag_name: tag.name,
          name: `Tag: ${tag.name}`,
          body: "",
          created_at: fetchedAtTimestamp,
          published_at: fetchedAtTimestamp,
          prerelease: false,
          draft: false,
        } satisfies GithubRelease,
      }));

      const selectedCandidate = tagCandidates.find(({ release }) =>
        releaseMatchesEffectiveFilters(
          release,
          {
            effectiveReleaseChannels,
            effectivePreReleaseSubChannels,
            totalReleasesToFetch,
            effectiveIncludeRegex,
            effectiveExcludeRegex,
          },
          `${owner}/${repo}`,
        ),
      );

      if (!selectedCandidate) {
        log.info(
          `No tags found for ${owner}/${repo} matching the configured filters.`,
        );
        return {
          release: null,
          error: { type: "no_matching_releases" },
          newEtag,
        };
      }

      const latestTag = selectedCandidate.tag;
      const t = await getTranslations({ locale, namespace: "Actions" });

      let bodyContent = "";
      let publicationDate = new Date().toISOString();

      try {
        const { response: refResponse, data: refData } =
          await fetchJsonResponseWithRetry<{
            object: { type: string; sha: string; url: string };
          }>(
            `${GITHUB_API_BASE_URL}/git/ref/tags/${latestTag.name}`,
            { headers, cache: "no-store" },
            {
              description: `Git reference for ${owner}/${repo} tag ${latestTag.name}`,
            },
          );

        if (refResponse.ok && refData) {
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
                bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${annotatedTagData.message}`;
              }
              publicationDate =
                annotatedTagData.tagger?.date || publicationDate;
            }
          }
        }

        // If no annotated tag message was found (either lightweight tag or error), fall back to commit message.
        if (!bodyContent) {
          const { response: commitResponse, data: commitData } =
            await fetchJsonResponseWithRetry<{
              commit: { message: string; committer: { date: string } };
            }>(
              `${GITHUB_API_BASE_URL}/commits/${latestTag.commit.sha}`,
              { headers, cache: "no-store" },
              {
                description: `GitHub commit ${latestTag.commit.sha} for ${owner}/${repo}`,
              },
            );
          if (commitResponse.ok && commitData) {
            bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commitData.commit.message}`;
            publicationDate = commitData.commit.committer.date;
          } else {
            log.error(
              `Failed to fetch commit for tag ${latestTag.name} in ${owner}/${repo}.`,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }
        }
      } catch (e) {
        log.error(`Error during tag fallback for ${owner}/${repo}:`, e);
        return { release: null, error: { type: "api_error" } };
      }

      const virtualRelease: GithubRelease = {
        ...selectedCandidate.release,
        body: bodyContent,
        created_at: publicationDate,
        published_at: publicationDate,
      };
      allReleases = [virtualRelease];
    }

    // Filter releases according to configured channels/regex
    const filteredReleases = allReleases.filter((release) =>
      releaseMatchesEffectiveFilters(
        release,
        {
          effectiveReleaseChannels,
          effectivePreReleaseSubChannels,
          totalReleasesToFetch,
          effectiveIncludeRegex,
          effectiveExcludeRegex,
        },
        `${owner}/${repo}`,
      ),
    );

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    // Sort by published_at (fallback to created_at) desc to ensure stability
    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

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
          latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commitData.commit.message}`;
          log.info(
            `Successfully fetched commit message for ${owner}/${repo} tag ${latestRelease.tag_name}.`,
          );
        } else if (commitResponse.ok) {
          log.info(
            `Commit message for ${owner}/${repo} tag ${latestRelease.tag_name} could not be retrieved from commit data.`,
          );
        } else {
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

    if (latestRelease) {
      latestRelease.fetched_at = new Date().toISOString();
    }

    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

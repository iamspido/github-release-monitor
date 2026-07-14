import { getTranslations } from "next-intl/server";
import { buildGitlabAuthChain } from "@/lib/releases/auth-chains";
import { fetchJsonResponseWithRetryAuthChain } from "@/lib/releases/fetch";
import { resolveEffectiveRepoFilters } from "@/lib/releases/filters";
import {
  fetchGitlabTagsViaGitTransport,
  tryFetchGitlabCommitMetadataViaGitTransport,
} from "@/lib/releases/gitlab-git-transport";
import {
  notModifiedResult,
  resolvePageCount,
  resolvePageSize,
  selectLatestMatchingRelease,
} from "@/lib/releases/provider-pipeline";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import {
  type GitlabAuthConfig,
  getGitlabAuthForHost,
} from "@/lib/repositories/providers";
import { log } from "@/lib/server-action-helpers";
import type { AppSettings, GithubRelease } from "@/types";

type GitlabReleaseApi = {
  name?: string | null;
  tag_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  released_at?: string | null;
  upcoming_release?: boolean | null;
};

type GitlabTagApi = {
  name: string;
  message?: string | null;
  release?: {
    description?: string | null;
  } | null;
  commit?: {
    id?: string | null;
    message?: string | null;
    created_at?: string | null;
    committed_date?: string | null;
    authored_date?: string | null;
  } | null;
};

type GitlabCommitApi = {
  message?: string | null;
  committed_date?: string | null;
  authored_date?: string | null;
  created_at?: string | null;
};

function hashStringToId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function extractGitlabCommitDate(
  commit:
    | {
        committed_date?: string | null;
        authored_date?: string | null;
        created_at?: string | null;
      }
    | null
    | undefined,
): string | undefined {
  if (!commit) return undefined;
  if (typeof commit.committed_date === "string") return commit.committed_date;
  if (typeof commit.authored_date === "string") return commit.authored_date;
  if (typeof commit.created_at === "string") return commit.created_at;
  return undefined;
}

async function tryFetchGitlabCommitMessage(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const chain = buildGitlabAuthChain(headersWithoutAuth, auth);
  const url = `${apiBaseUrl}/repository/commits/${encodeURIComponent(refOrSha)}`;
  try {
    const { response, data } =
      await fetchJsonResponseWithRetryAuthChain<GitlabCommitApi>(url, chain, {
        description: `GitLab commit (${refOrSha})`,
      });
    if (!response.ok || !data) return null;

    const message = typeof data.message === "string" ? data.message : undefined;
    const date = extractGitlabCommitDate(data);

    if (!message && !date) return null;
    return { message, date };
  } catch {
    return null;
  }
}

export async function fetchLatestReleaseFromGitLab(
  gitlabHost: string,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  const projectPath = `${owner}/${repo}`;
  log.info(`Fetching GitLab release for ${projectPath} on ${gitlabHost}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const filters = resolveEffectiveRepoFilters(repoSettings, globalSettings);
  const { totalReleasesToFetch } = filters;

  const GITLAB_API_BASE_URL = `https://${gitlabHost}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = resolvePageCount(totalReleasesToFetch, MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;
  let fellBackToTagsAfterReleases404 = false;
  const gitTransportCommitShasByTag = new Map<string, string>();
  const apiCommitRefsByTag = new Map<string, string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const gitlabAuth = getGitlabAuthForHost(gitlabHost);

  try {
    for (let page = 1; page <= pagesToFetch; page += 1) {
      const releasesOnThisPage = resolvePageSize({
        maxPerPage: MAX_PER_PAGE,
        totalItemsToFetch: totalReleasesToFetch,
        alreadyFetched: allReleases.length,
      });
      if (releasesOnThisPage <= 0) break;

      const url = `${GITLAB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      if (page === 1 && repoSettings.etag) {
        currentHeadersWithoutAuth["If-None-Match"] = repoSettings.etag;
      }

      const chain = buildGitlabAuthChain(currentHeadersWithoutAuth, gitlabAuth);

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<GitlabReleaseApi[]>(
          url,
          chain,
          {
            description: `GitLab releases for ${projectPath} page ${page}`,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          return notModifiedResult(
            `gitlab:${gitlabHost}/${projectPath}`,
            repoSettings.etag,
          );
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          if (gitlabAuth?.deployToken && !gitlabAuth.accessToken) {
            log.warn(
              `GitLab releases endpoint returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Falling back to tags endpoint.`,
            );
            fellBackToTagsAfterReleases404 = true;
            break;
          }
          log.error(
            `GitLab API error for ${projectPath}: Not Found (404). The repository may not exist or is private.`,
          );
          return { release: null, error: { type: "repo_not_found" }, newEtag };
        }
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get("retry-after"))
        ) {
          const retryAfter = response.headers.get("retry-after") ?? "N/A";
          const remaining =
            response.headers.get("ratelimit-remaining") ?? "N/A";
          const reset = response.headers.get("ratelimit-reset") ?? "N/A";
          log.error(
            `GitLab API rate limit exceeded for ${projectPath}. Remaining: ${remaining}, Reset: ${reset}, Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `GitLab API error for ${projectPath}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `GitLab API returned an empty body for ${projectPath} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases
          .map((release) => {
            const tagName =
              typeof release.tag_name === "string" ? release.tag_name : null;
            if (!tagName) return null;

            const createdAt =
              typeof release.created_at === "string"
                ? release.created_at
                : typeof release.released_at === "string"
                  ? release.released_at
                  : fetchedAtTimestamp;

            const publishedAt =
              typeof release.released_at === "string"
                ? release.released_at
                : typeof release.created_at === "string"
                  ? release.created_at
                  : null;

            const mapped: GithubRelease = {
              id: hashStringToId(tagName),
              html_url: `https://${gitlabHost}/${projectPath}/-/releases/${encodeURIComponent(tagName)}`,
              tag_name: tagName,
              name: typeof release.name === "string" ? release.name : null,
              body:
                typeof release.description === "string"
                  ? release.description
                  : null,
              created_at: createdAt,
              published_at: publishedAt,
              prerelease: false,
              draft: !!release.upcoming_release,
            };
            return mapped;
          })
          .filter((release): release is GithubRelease => release !== null),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      if (fellBackToTagsAfterReleases404) {
        log.info(
          `Falling back to tags for ${projectPath} after releases endpoint 404.`,
        );
      } else {
        log.info(
          `No formal releases found for ${projectPath}. Falling back to tags.`,
        );
      }
      let tagsResponse: Response | null = null;
      const tags: GitlabTagApi[] = [];
      let hadSuccessfulTagResponse = false;

      const tagPagesToFetch = resolvePageCount(
        totalReleasesToFetch,
        MAX_PER_PAGE,
      );
      for (let page = 1; page <= tagPagesToFetch; page += 1) {
        const tagsOnThisPage = resolvePageSize({
          maxPerPage: MAX_PER_PAGE,
          totalItemsToFetch: totalReleasesToFetch,
          alreadyFetched: tags.length,
        });
        const tagUrls = [
          `${GITLAB_API_BASE_URL}/repository/tags?per_page=${tagsOnThisPage}&page=${page}&order_by=updated&sort=desc`,
          `${GITLAB_API_BASE_URL}/repository/tags?per_page=${tagsOnThisPage}&page=${page}`,
          ...(page === 1 ? [`${GITLAB_API_BASE_URL}/repository/tags`] : []),
        ];

        let pageTags: GitlabTagApi[] | null = null;
        for (const tagUrl of tagUrls) {
          const tagChain = buildGitlabAuthChain(headersWithoutAuth, gitlabAuth);
          const result = await fetchJsonResponseWithRetryAuthChain<
            GitlabTagApi[]
          >(tagUrl, tagChain, {
            description: `GitLab tags for ${projectPath} page ${page}`,
          });
          tagsResponse = result.response;

          if (!tagsResponse.ok) {
            // Some GitLab versions don't support order_by/sort on tags. Retry with a simpler endpoint.
            if (tagsResponse.status === 400) {
              continue;
            }
            break;
          }

          hadSuccessfulTagResponse = true;
          pageTags = result.data ?? [];
          break;
        }

        if (!pageTags) break;
        tags.push(...pageTags);
        if (pageTags.length < tagsOnThisPage) break;
      }

      if (!hadSuccessfulTagResponse) {
        let bodyText: string | undefined;
        try {
          bodyText = tagsResponse ? await tagsResponse.text() : undefined;
        } catch {
          bodyText = undefined;
        }

        const details =
          tagsResponse == null
            ? "no response"
            : `${tagsResponse.status} ${tagsResponse.statusText}`;

        const canTryGitTransportFallback =
          tagsResponse?.status === 404 &&
          Boolean(gitlabAuth?.deployToken && !gitlabAuth.accessToken);

        if (canTryGitTransportFallback) {
          log.warn(
            `Tag API returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Trying Git transport fallback.`,
            bodyText ? { bodyText } : undefined,
          );

          try {
            const deployToken = gitlabAuth?.deployToken;
            if (!deployToken) {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
            const gitTransportTags = await fetchGitlabTagsViaGitTransport(
              gitlabHost,
              projectPath,
              deployToken,
            );

            if (gitTransportTags && gitTransportTags.length > 0) {
              const t = await getTranslations({ locale, namespace: "Actions" });
              const commitTitle = t("commit_message_fallback_title");
              const unavailableText = t("commit_message_unavailable_fallback");
              const fallbackTimestamp = new Date().toISOString();
              allReleases = gitTransportTags.map((tag) => {
                if (tag.commitSha) {
                  gitTransportCommitShasByTag.set(tag.name, tag.commitSha);
                }
                const shortSha = tag.commitSha?.slice(0, 12);
                const body = shortSha
                  ? `### ${commitTitle}\n\n---\n\n${unavailableText}\n\nCommit: \`${shortSha}\``
                  : `### ${commitTitle}\n\n---\n\n${unavailableText}`;

                return {
                  id: hashStringToId(tag.name),
                  html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(tag.name)}`,
                  tag_name: tag.name,
                  name: `Tag: ${tag.name}`,
                  body,
                  created_at: fallbackTimestamp,
                  published_at: fallbackTimestamp,
                  published_at_unknown: true,
                  prerelease: false,
                  draft: false,
                };
              });
              log.info(
                `Git transport fallback found ${gitTransportTags.length} tags for ${projectPath}.`,
              );
            } else if (gitTransportTags && gitTransportTags.length === 0) {
              log.info(
                `Git transport fallback found no tags for ${projectPath}.`,
              );
              return {
                release: null,
                error: { type: "no_releases_found" },
                newEtag,
              };
            } else {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
          } catch (error) {
            log.error(
              `Git transport fallback failed for ${projectPath} on ${gitlabHost}.`,
              error,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }
        } else {
          log.error(
            `Failed to fetch tags for ${projectPath} after failing to find releases. (${details})`,
            bodyText ? { bodyText } : undefined,
          );
          if (tagsResponse?.status === 404) {
            return {
              release: null,
              error: { type: "repo_not_found" },
              newEtag,
            };
          }
          return { release: null, error: { type: "api_error" }, newEtag };
        }
      }

      if (allReleases.length === 0) {
        if (tags.length === 0) {
          log.info(`No tags found for ${projectPath}.`);
          return {
            release: null,
            error: { type: "no_releases_found" },
            newEtag,
          };
        }

        const t = await getTranslations({ locale, namespace: "Actions" });
        allReleases = tags.map((tag) => {
          if (typeof tag.commit?.id === "string") {
            apiCommitRefsByTag.set(tag.name, tag.commit.id);
          }
          const tagMessage =
            typeof tag.message === "string" ? tag.message : null;
          const releaseDescription =
            typeof tag.release?.description === "string"
              ? tag.release.description
              : null;
          const commitMessage =
            typeof tag.commit?.message === "string" ? tag.commit.message : null;
          const bodyContent = tagMessage
            ? `### ${t("tag_message_fallback_title")}\n\n---\n\n${tagMessage}`
            : releaseDescription
              ? `### ${t("tag_message_fallback_title")}\n\n---\n\n${releaseDescription}`
              : commitMessage
                ? `### ${t("commit_message_fallback_title")}\n\n---\n\n${commitMessage}`
                : "";
          const publicationDate =
            extractGitlabCommitDate(tag.commit) || fetchedAtTimestamp;

          return {
            id: 0,
            html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(tag.name)}`,
            tag_name: tag.name,
            name: `Tag: ${tag.name}`,
            body: bodyContent,
            created_at: publicationDate,
            published_at: publicationDate,
            prerelease: false,
            draft: false,
          };
        });
      }
    }

    const latestRelease = selectLatestMatchingRelease({
      releases: allReleases,
      filters,
      repoIdForLog: `gitlab:${gitlabHost}/${projectPath}`,
    });

    if (!latestRelease) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    if (
      latestRelease.published_at_unknown &&
      gitlabAuth?.deployToken &&
      !gitlabAuth.accessToken
    ) {
      const commitSha = gitTransportCommitShasByTag.get(latestRelease.tag_name);
      if (commitSha) {
        const metadata = await tryFetchGitlabCommitMetadataViaGitTransport(
          gitlabHost,
          projectPath,
          gitlabAuth.deployToken,
          commitSha,
        );
        if (metadata?.message) {
          const t = await getTranslations({ locale, namespace: "Actions" });
          latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${metadata.message}`;
        }
        if (metadata?.date) {
          latestRelease.created_at = metadata.date;
          latestRelease.published_at = metadata.date;
          latestRelease.published_at_unknown = false;
        }
      }
    }

    if (!latestRelease.body || latestRelease.body.trim() === "") {
      const commit = await tryFetchGitlabCommitMessage(
        GITLAB_API_BASE_URL,
        headersWithoutAuth,
        gitlabAuth,
        apiCommitRefsByTag.get(latestRelease.tag_name) ??
          latestRelease.tag_name,
      );
      if (commit?.message) {
        const t = await getTranslations({ locale, namespace: "Actions" });
        latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
      }
      if (commit?.date) {
        latestRelease.published_at = latestRelease.published_at ?? commit.date;
      }
    }

    latestRelease.fetched_at = fetchedAtTimestamp;
    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch GitLab releases for ${projectPath}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

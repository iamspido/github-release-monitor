import { getTranslations } from "next-intl/server";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { buildGitlabAuthChain } from "@/lib/releases/auth-chains";
import {
  applyVerifiedCommitLinks,
  canReuseCommitLinkState,
  inheritCommitLinkState,
  resolveCommitLinkCandidates,
} from "@/lib/releases/commit-links";
import { fetchJsonResponseWithRetryAuthChain } from "@/lib/releases/fetch";
import {
  isCachedTagFallbackRelease,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import {
  fetchGitlabTagsViaGitTransport,
  tryFetchGitlabCommitMetadataViaGitTransport,
} from "@/lib/releases/gitlab-git-transport";
import {
  applyCommitMetadata,
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
import {
  type GitlabAuthConfig,
  getGitlabAuthForHost,
} from "@/lib/repositories/providers";
import { log } from "@/lib/server-action-helpers";
import type { AppSettings, FetchError, GithubRelease, Locale } from "@/types";

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
  id?: string | null;
  web_url?: string | null;
  message?: string | null;
  committed_date?: string | null;
  authored_date?: string | null;
  created_at?: string | null;
};

function normalizeGitlabCommitUrl(
  value: string,
  gitlabHost: string,
  sha: string,
): string | null {
  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== gitlabHost.toLowerCase() ||
      url.username ||
      url.password ||
      !decodedPath.endsWith(`/-/commit/${sha}`)
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function resolveGitlabCommitLinks(args: {
  apiBaseUrl: string;
  auth: GitlabAuthConfig | null;
  candidates: readonly string[];
  deadline: number;
  gitlabHost: string;
  headersWithoutAuth: Record<string, string>;
  projectPath: string;
}) {
  return resolveCommitLinkCandidates({
    candidates: args.candidates,
    deadline: args.deadline,
    resolve: async (ref, deadline) => {
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) return { status: "retry" };
      try {
        const chain = buildGitlabAuthChain(args.headersWithoutAuth, args.auth);
        const { response, data } =
          await fetchJsonResponseWithRetryAuthChain<GitlabCommitApi>(
            `${args.apiBaseUrl}/repository/commits/${encodeURIComponent(ref)}?stats=false`,
            chain,
            {
              deadlineMs: deadline,
              description: `GitLab commit link (${ref}) for ${args.projectPath}`,
              maxAttempts: 1,
              parseAttempts: 1,
              timeoutMs,
            },
          );

        if (response.status === 404 || response.status === 422) {
          await discardResponseWithTimeout(response);
          return { status: "not_found" };
        }
        if (!response.ok || !data) {
          await discardResponseWithTimeout(response);
          return { status: "retry" };
        }

        const sha =
          typeof data.id === "string" ? data.id.trim().toLowerCase() : "";
        const url =
          typeof data.web_url === "string"
            ? normalizeGitlabCommitUrl(data.web_url, args.gitlabHost, sha)
            : null;
        if (!/^[0-9a-f]{40}$/.test(sha) || !sha.startsWith(ref) || !url) {
          return { status: "retry" };
        }
        return { status: "resolved", link: { ref, sha, url } };
      } catch (error) {
        log.warn(
          `Could not resolve GitLab commit link ${ref} for ${args.projectPath}.`,
          error,
        );
        return { status: "retry" };
      }
    },
  });
}

function hashStringToId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function mapGitlabRelease(
  release: GitlabReleaseApi,
  gitlabHost: string,
  projectPath: string,
  fallbackTimestamp: string,
): GithubRelease | null {
  const tagName =
    typeof release.tag_name === "string" ? release.tag_name : null;
  if (!tagName) return null;

  const createdAt =
    typeof release.created_at === "string"
      ? release.created_at
      : typeof release.released_at === "string"
        ? release.released_at
        : fallbackTimestamp;
  const publishedAt =
    typeof release.released_at === "string"
      ? release.released_at
      : typeof release.created_at === "string"
        ? release.created_at
        : null;

  return {
    id: hashStringToId(tagName),
    html_url: `https://${gitlabHost}/${projectPath}/-/releases/${encodeURIComponent(tagName)}`,
    tag_name: tagName,
    name: typeof release.name === "string" ? release.name : null,
    body: typeof release.description === "string" ? release.description : null,
    created_at: createdAt,
    published_at: publishedAt,
    prerelease: false,
    draft: !!release.upcoming_release,
  };
}

async function fetchGitlabProviderLatestRelease(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
  gitlabHost: string,
  projectPath: string,
  fallbackTimestamp: string,
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  const chain = buildGitlabAuthChain(headersWithoutAuth, auth);
  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<GitlabReleaseApi>(
      `${apiBaseUrl}/releases/permalink/latest`,
      chain,
      { description: `GitLab provider-latest release for ${projectPath}` },
    );

  if (!response.ok) {
    await discardResponseWithTimeout(response);
    if (response.status === 404) {
      return { release: null, error: null };
    }
    const error: FetchError = {
      type:
        response.status === 429 ||
        (response.status === 403 && response.headers.get("retry-after"))
          ? "rate_limit"
          : "api_error",
    };
    log.warn(
      `GitLab provider-latest endpoint failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText}`,
    );
    return { release: null, error };
  }

  return {
    release: data
      ? mapGitlabRelease(data, gitlabHost, projectPath, fallbackTimestamp)
      : null,
    error: null,
  };
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
    if (!response.ok) {
      await discardResponseWithTimeout(response);
      return null;
    }
    if (!data) return null;

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
  locale: Locale,
): Promise<LatestReleaseFetchResult> {
  const projectPath = `${owner}/${repo}`;
  log.info(`Fetching GitLab release for ${projectPath} on ${gitlabHost}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const filters = resolveEffectiveRepoFilters(repoSettings, globalSettings);
  const { effectiveReleaseSelectionStrategy, totalReleasesToFetch } = filters;

  const GITLAB_API_BASE_URL = `https://${gitlabHost}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = resolvePageCount(totalReleasesToFetch, MAX_PER_PAGE);
  const releasePagesToFetch =
    effectiveReleaseSelectionStrategy === "provider_latest" ? 1 : pagesToFetch;
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;
  let providerLatestRelease: GithubRelease | null | undefined;
  let fellBackToTagsAfterReleases404 = false;
  const gitTransportCommitShasByTag = new Map<string, string>();
  const apiCommitRefsByTag = new Map<string, string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const gitlabAuth = getGitlabAuthForHost(gitlabHost);

  try {
    if (effectiveReleaseSelectionStrategy === "provider_latest") {
      const providerLatestResult = await fetchGitlabProviderLatestRelease(
        GITLAB_API_BASE_URL,
        headersWithoutAuth,
        gitlabAuth,
        gitlabHost,
        projectPath,
        fetchedAtTimestamp,
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
      page += 1
    ) {
      const releasesOnThisPage = resolvePageSize({
        maxPerPage: MAX_PER_PAGE,
        totalItemsToFetch: totalReleasesToFetch,
        alreadyFetched: allReleases.length,
      });
      if (releasesOnThisPage <= 0) break;

      const url = `${GITLAB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      // A page-one ETag cannot validate candidates from later pages.
      if (
        page === 1 &&
        releasePagesToFetch === 1 &&
        effectiveReleaseSelectionStrategy !== "provider_latest" &&
        repoSettings.etag &&
        repoSettings.latestRelease &&
        canReuseCommitLinkState(repoSettings.latestRelease) &&
        !isCachedTagFallbackRelease(repoSettings.latestRelease)
      ) {
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
        await discardResponseWithTimeout(response);
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
          .map((release) =>
            mapGitlabRelease(
              release,
              gitlabHost,
              projectPath,
              fetchedAtTimestamp,
            ),
          )
          .filter((release): release is GithubRelease => release !== null),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (
      allReleases.length === 0 &&
      effectiveReleaseSelectionStrategy !== "provider_latest"
    ) {
      newEtag = null;
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
              await discardResponseWithTimeout(tagsResponse);
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

      if (hadSuccessfulTagResponse && tagsResponse && !tagsResponse.ok) {
        const errorType: FetchError["type"] =
          tagsResponse.status === 429 ||
          (tagsResponse.status === 403 &&
            Boolean(tagsResponse.headers.get("retry-after")))
            ? "rate_limit"
            : "api_error";
        log.error(
          `GitLab tag pagination failed for ${projectPath} on ${gitlabHost}: ${tagsResponse.status} ${tagsResponse.statusText}. Refusing to select from partial results.`,
        );
        await discardResponseWithTimeout(tagsResponse);
        return { release: null, error: { type: errorType }, newEtag };
      }

      if (!hadSuccessfulTagResponse) {
        let bodyText: string | undefined;
        try {
          bodyText = tagsResponse
            ? await consumeResponseWithTimeout(tagsResponse, (response) =>
                response.text(),
              )
            : undefined;
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
          if (
            tagsResponse?.status === 429 ||
            (tagsResponse?.status === 403 &&
              tagsResponse.headers.get("retry-after"))
          ) {
            return {
              release: null,
              error: { type: "rate_limit" },
              newEtag,
            };
          }
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
            ? buildFallbackMarkdown(t("tag_message_fallback_title"), tagMessage)
            : releaseDescription
              ? buildFallbackMarkdown(
                  t("tag_message_fallback_title"),
                  releaseDescription,
                )
              : commitMessage
                ? buildFallbackMarkdown(
                    t("commit_message_fallback_title"),
                    commitMessage,
                  )
                : "";
          const commitDate = extractGitlabCommitDate(tag.commit);
          const publicationDate = commitDate || fetchedAtTimestamp;

          return {
            id: 0,
            html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(tag.name)}`,
            tag_name: tag.name,
            name: `Tag: ${tag.name}`,
            body: bodyContent,
            created_at: publicationDate,
            published_at: publicationDate,
            published_at_unknown: !commitDate,
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
      strategy: effectiveReleaseSelectionStrategy,
      providerLatestRelease,
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
        const t = await getTranslations({ locale, namespace: "Actions" });
        applyCommitMetadata(
          latestRelease,
          metadata,
          t("commit_message_fallback_title"),
          { replaceBody: true },
        );
      }
    }

    if (
      latestRelease.published_at_unknown ||
      !latestRelease.body ||
      latestRelease.body.trim() === ""
    ) {
      const commit = await tryFetchGitlabCommitMessage(
        GITLAB_API_BASE_URL,
        headersWithoutAuth,
        gitlabAuth,
        apiCommitRefsByTag.get(latestRelease.tag_name) ??
          latestRelease.tag_name,
      );
      const t = await getTranslations({ locale, namespace: "Actions" });
      applyCommitMetadata(
        latestRelease,
        commit,
        t("commit_message_fallback_title"),
      );
    }

    inheritCommitLinkState(latestRelease, repoSettings.latestRelease);
    await applyVerifiedCommitLinks({
      release: latestRelease,
      resolve: (candidates, deadline) =>
        resolveGitlabCommitLinks({
          apiBaseUrl: GITLAB_API_BASE_URL,
          auth: gitlabAuth,
          candidates,
          deadline,
          gitlabHost,
          headersWithoutAuth,
          projectPath,
        }),
    });

    return releaseSuccessResult(latestRelease, newEtag, fetchedAtTimestamp);
  } catch (error) {
    log.error(`Failed to fetch GitLab releases for ${projectPath}:`, error);
    return { release: null, error: { type: "api_error" }, newEtag: null };
  }
}

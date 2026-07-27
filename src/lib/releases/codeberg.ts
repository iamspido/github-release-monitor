import { getTranslations } from "next-intl/server";
import { discardResponseWithTimeout } from "@/lib/http/fetch-with-timeout";
import { buildCodebergAuthChain } from "@/lib/releases/auth-chains";
import { fetchJsonResponseWithRetryAuthChain } from "@/lib/releases/fetch";
import {
  isCachedTagFallbackRelease,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
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
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type { AppSettings, FetchError, GithubRelease, Locale } from "@/types";

type CodebergReleaseApi = {
  id: number;
  html_url?: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  created_at: string;
  published_at: string | null;
  prerelease?: boolean;
  draft?: boolean;
};

type CodebergTagApi = {
  name: string;
  message?: string | null;
  commit?: {
    sha?: string | null;
    id?: string | null;
    url?: string | null;
  } | null;
};

type CodebergCommitApi = {
  message?: string | null;
  author?: { date?: string | null } | null;
  committer?: { date?: string | null } | null;
  commit?: {
    message?: string | null;
    committer?: { date?: string | null } | null;
  } | null;
};

type CodebergRepoApi = {
  has_releases?: boolean | null;
  release_counter?: number | null;
};

function mapCodebergRelease(
  release: CodebergReleaseApi,
  owner: string,
  repo: string,
): GithubRelease {
  return {
    id: release.id,
    html_url:
      release.html_url ??
      `https://codeberg.org/${owner}/${repo}/releases/tag/${release.tag_name}`,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    created_at: release.created_at,
    published_at: release.published_at,
    prerelease: !!release.prerelease,
    draft: !!release.draft,
  };
}

async function fetchCodebergProviderLatestRelease(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  owner: string,
  repo: string,
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  const chain = buildCodebergAuthChain(headersWithoutAuth, authToken);
  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<CodebergReleaseApi>(
      `${apiBaseUrl}/releases/latest`,
      chain,
      { description: `Codeberg provider-latest release for ${owner}/${repo}` },
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
      `Codeberg provider-latest endpoint failed for ${owner}/${repo}: ${response.status} ${response.statusText}`,
    );
    return { release: null, error };
  }

  return {
    release: data ? mapCodebergRelease(data, owner, repo) : null,
    error: null,
  };
}

function extractCodebergTagCommitSha(tag: CodebergTagApi): string | undefined {
  const commit = tag.commit;
  const sha =
    (typeof commit?.sha === "string" && commit.sha.trim()) ||
    (typeof commit?.id === "string" && commit.id.trim()) ||
    undefined;
  if (sha) return sha;

  if (typeof commit?.url === "string") {
    try {
      const url = new URL(commit.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts.at(-1);
      if (last) return last;
    } catch {
      // ignore
    }
  }

  return undefined;
}

async function tryFetchCodebergCommitMessage(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const candidates = [
    `${apiBaseUrl}/commits/${refOrSha}`,
    `${apiBaseUrl}/git/commits/${refOrSha}`,
  ];

  const chain = buildCodebergAuthChain(headersWithoutAuth, authToken);

  for (const url of candidates) {
    try {
      const { response, data } =
        await fetchJsonResponseWithRetryAuthChain<CodebergCommitApi>(
          url,
          chain,
          { description: `Codeberg commit (${refOrSha})` },
        );
      if (!response.ok) {
        await discardResponseWithTimeout(response);
        continue;
      }
      if (!data) continue;

      const message: string | undefined =
        typeof data.message === "string"
          ? data.message
          : typeof data.commit?.message === "string"
            ? data.commit.message
            : undefined;

      const date: string | undefined =
        typeof data.author?.date === "string"
          ? data.author.date
          : typeof data.committer?.date === "string"
            ? data.committer.date
            : typeof data.commit?.committer?.date === "string"
              ? data.commit.committer.date
              : undefined;

      if (message || date) return { message, date };
    } catch {
      // best-effort only
    }
  }

  return null;
}

async function fetchCodebergRepoInfo(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  owner: string,
  repo: string,
): Promise<
  | { ok: true; data: CodebergRepoApi }
  | { ok: false; status: number; statusText: string }
> {
  const chain = buildCodebergAuthChain(headersWithoutAuth, authToken);

  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<CodebergRepoApi>(
      apiBaseUrl,
      chain,
      { description: `Codeberg repo info for ${owner}/${repo}` },
    );

  if (!response.ok) {
    const status = response.status;
    const statusText = response.statusText;
    await discardResponseWithTimeout(response);
    return {
      ok: false,
      status,
      statusText,
    };
  }

  return { ok: true, data: data ?? {} };
}

export async function fetchLatestReleaseFromCodeberg(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: Locale,
): Promise<LatestReleaseFetchResult> {
  log.info(`Fetching Codeberg release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const filters = resolveEffectiveRepoFilters(repoSettings, globalSettings);
  const { effectiveReleaseSelectionStrategy, totalReleasesToFetch } = filters;

  const CODEBERG_API_BASE_URL = `https://codeberg.org/api/v1/repos/${owner}/${repo}`;
  const MAX_PER_PAGE = 50;
  const pagesToFetch = resolvePageCount(totalReleasesToFetch, MAX_PER_PAGE);
  const releasePagesToFetch =
    effectiveReleaseSelectionStrategy === "provider_latest" ? 1 : pagesToFetch;
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;
  let providerLatestRelease: GithubRelease | null | undefined;
  let tagFallbackReason: string | undefined;
  const commitRefsByTag = new Map<string, string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const codebergToken = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);

  try {
    if (effectiveReleaseSelectionStrategy === "provider_latest") {
      const providerLatestResult = await fetchCodebergProviderLatestRelease(
        CODEBERG_API_BASE_URL,
        headersWithoutAuth,
        codebergToken,
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

      const url = `${CODEBERG_API_BASE_URL}/releases?limit=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      // A page-one ETag cannot validate candidates from later pages.
      if (
        page === 1 &&
        releasePagesToFetch === 1 &&
        effectiveReleaseSelectionStrategy !== "provider_latest" &&
        repoSettings.etag &&
        repoSettings.latestRelease &&
        !isCachedTagFallbackRelease(repoSettings.latestRelease)
      ) {
        currentHeadersWithoutAuth["If-None-Match"] = repoSettings.etag;
      }

      const chain = buildCodebergAuthChain(
        currentHeadersWithoutAuth,
        codebergToken,
      );

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<CodebergReleaseApi[]>(
          url,
          chain,
          {
            description: `Codeberg releases for ${owner}/${repo} page ${page}`,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          return notModifiedResult(
            `codeberg:${owner}/${repo}`,
            repoSettings.etag,
          );
        }
      }

      if (!response.ok) {
        await discardResponseWithTimeout(response);
        if (response.status === 404) {
          // Codeberg (Gitea/Forgejo) may return 404 on the releases endpoint if releases are disabled,
          // even though the repository exists and tags are available.
          if (page === 1) {
            const repoInfo = await fetchCodebergRepoInfo(
              CODEBERG_API_BASE_URL,
              headersWithoutAuth,
              codebergToken,
              owner,
              repo,
            );

            if (repoInfo.ok) {
              tagFallbackReason = "releases_endpoint_404";
              break;
            }

            if (repoInfo.status === 404) {
              log.error(
                `Codeberg API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`,
              );
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }

            log.error(
              `Codeberg API error for ${owner}/${repo}: ${repoInfo.status} ${repoInfo.statusText}`,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }

          // For later pages, a 404 can happen if pagination exceeds available pages. Treat it as end.
          break;
        }
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get("retry-after"))
        ) {
          const retryAfter = response.headers.get("retry-after") ?? "N/A";
          log.error(
            `Codeberg API rate limit exceeded for ${owner}/${repo}. Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `Codeberg API error for ${owner}/${repo}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `Codeberg API returned an empty body for ${owner}/${repo} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases.map((release) =>
          mapCodebergRelease(release, owner, repo),
        ),
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
      const reason = tagFallbackReason ?? "no_formal_releases";
      log.info(
        `Codeberg releases unavailable for codeberg:${owner}/${repo} (reason=${reason}). Falling back to tags.`,
      );

      let tagsResponse: Response | null = null;
      const tags: CodebergTagApi[] = [];
      let tagPaginationFailed = false;
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
          `${CODEBERG_API_BASE_URL}/tags?limit=${tagsOnThisPage}&page=${page}`,
          `${CODEBERG_API_BASE_URL}/tags?per_page=${tagsOnThisPage}&page=${page}`,
          ...(page === 1 ? [`${CODEBERG_API_BASE_URL}/tags`] : []),
        ];
        let pageTags: CodebergTagApi[] | null = null;

        for (const tagUrl of tagUrls) {
          try {
            const tagChain = buildCodebergAuthChain(
              headersWithoutAuth,
              codebergToken,
            );

            const result = await fetchJsonResponseWithRetryAuthChain<
              CodebergTagApi[]
            >(tagUrl, tagChain, {
              description: `Codeberg tags for ${owner}/${repo} page ${page}`,
            });

            tagsResponse = result.response;
            if (!tagsResponse.ok) {
              await discardResponseWithTimeout(tagsResponse);
              continue;
            }

            pageTags = result.data ?? [];
            break;
          } catch {
            // Try the next candidate URL
          }
        }

        if (!pageTags) {
          tagPaginationFailed = true;
          break;
        }
        tags.push(...pageTags);
        if (pageTags.length < tagsOnThisPage) break;
      }

      if (tagPaginationFailed) {
        const errorType: FetchError["type"] =
          tagsResponse?.status === 429 ||
          (tagsResponse?.status === 403 &&
            Boolean(tagsResponse.headers.get("retry-after")))
            ? "rate_limit"
            : "api_error";
        log.error(
          tags.length > 0
            ? `Codeberg tag pagination failed for ${owner}/${repo}. Refusing to select from partial results.`
            : `Failed to fetch tags for codeberg:${owner}/${repo} after failing to find releases.`,
        );
        return { release: null, error: { type: errorType }, newEtag };
      }

      if (tags.length === 0) {
        log.info(`No tags found for codeberg:${owner}/${repo}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const t = await getTranslations({ locale, namespace: "Actions" });
      allReleases = tags.map((tag) => {
        const commitRef = extractCodebergTagCommitSha(tag);
        if (commitRef) commitRefsByTag.set(tag.name, commitRef);
        return {
          id: 0,
          html_url: `https://codeberg.org/${owner}/${repo}/src/tag/${tag.name}`,
          tag_name: tag.name,
          name: `Tag: ${tag.name}`,
          body:
            typeof tag.message === "string"
              ? buildFallbackMarkdown(
                  t("tag_message_fallback_title"),
                  tag.message,
                )
              : "",
          created_at: fetchedAtTimestamp,
          published_at: fetchedAtTimestamp,
          published_at_unknown: true,
          prerelease: false,
          draft: false,
        };
      });
    }

    const latestRelease = selectLatestMatchingRelease({
      releases: allReleases,
      filters,
      repoIdForLog: `codeberg:${owner}/${repo}`,
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
      latestRelease.published_at_unknown ||
      !latestRelease.body ||
      latestRelease.body.trim() === ""
    ) {
      const commit = await tryFetchCodebergCommitMessage(
        CODEBERG_API_BASE_URL,
        headersWithoutAuth,
        codebergToken,
        commitRefsByTag.get(latestRelease.tag_name) ?? latestRelease.tag_name,
      );
      const t = await getTranslations({ locale, namespace: "Actions" });
      applyCommitMetadata(
        latestRelease,
        commit,
        t("commit_message_fallback_title"),
      );
    }

    return releaseSuccessResult(latestRelease, newEtag, fetchedAtTimestamp);
  } catch (error) {
    log.error(`Failed to fetch Codeberg releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" }, newEtag: null };
  }
}

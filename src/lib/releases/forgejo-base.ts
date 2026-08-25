// Codeberg and Forgejo share the same Gitea-compatible API.
// This module contains that shared implementation; provider-specific
// configuration (base URL, auth, repo ID) lives in codeberg.ts / forgejo.ts.

import { getTranslations } from "next-intl/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  discardResponseWithTimeout,
  isUrlWithinBaseUrl,
} from "@/lib/http/fetch-with-timeout";
import { buildForgejoAuthChain } from "@/lib/releases/auth-chains";
import {
  applyVerifiedCommitLinks,
  canReuseCommitLinkState,
  inheritCommitLinkState,
  resolveCommitLinkCandidates,
} from "@/lib/releases/commit-links";
import {
  fetchJsonResponseWithRetryAuthChain,
  isRateLimitedResponse,
} from "@/lib/releases/fetch";
import {
  createEffectiveReleaseMatcher,
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
import { log } from "@/lib/server-action-helpers";
import type { AppSettings, FetchError, GithubRelease, Locale } from "@/types";

type ForgejoReleaseApi = {
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

type ForgejoProviderLabel = "Codeberg" | "Forgejo";

type ForgejoTagApi = {
  name: string;
  message?: string | null;
  commit?: {
    sha?: string | null;
    id?: string | null;
    url?: string | null;
    created?: string | null;
  } | null;
};

type ForgejoCommitApi = {
  sha?: string | null;
  html_url?: string | null;
  created?: string | null;
  message?: string | null;
  author?: { date?: string | null } | null;
  committer?: { date?: string | null } | null;
  commit?: {
    message?: string | null;
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  } | null;
};

function normalizeForgejoCommitUrl(
  value: string,
  allowedBaseUrl: string,
  sha: string,
): string | null {
  try {
    const url = new URL(value);
    const baseUrl = new URL(allowedBaseUrl);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      !isUrlWithinBaseUrl(url, baseUrl) ||
      !decodedPath.endsWith(`/commit/${sha}`)
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

async function resolveForgejoCommitLinks(args: {
  allowedRedirectBaseUrl: string | null;
  apiBaseUrl: string;
  authToken: string | null;
  baseUrl: string;
  candidates: readonly string[];
  deadline: number;
  headersWithoutAuth: Record<string, string>;
  owner: string;
  providerLabel: ForgejoProviderLabel;
  repo: string;
}) {
  return resolveCommitLinkCandidates({
    candidates: args.candidates,
    deadline: args.deadline,
    resolve: async (ref, deadline) => {
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) return { status: "retry" };
      try {
        const chain = buildForgejoAuthChain(
          args.headersWithoutAuth,
          args.authToken,
        );
        const { response, data } =
          await fetchJsonResponseWithRetryAuthChain<ForgejoCommitApi>(
            `${args.apiBaseUrl}/git/commits/${encodeURIComponent(ref)}?stat=false&verification=false&files=false`,
            chain,
            {
              allowedRedirectBaseUrl: args.allowedRedirectBaseUrl ?? undefined,
              deadlineMs: deadline,
              description: `${args.providerLabel} commit link (${ref}) for ${args.owner}/${args.repo}`,
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
          typeof data.sha === "string" ? data.sha.trim().toLowerCase() : "";
        const url =
          typeof data.html_url === "string"
            ? normalizeForgejoCommitUrl(data.html_url, args.baseUrl, sha)
            : null;
        if (!/^[0-9a-f]{40}$/.test(sha) || !sha.startsWith(ref) || !url) {
          return { status: "retry" };
        }
        return { status: "resolved", link: { ref, sha, url } };
      } catch (error) {
        log.warn(
          `Could not resolve ${args.providerLabel} commit link ${ref} for ${args.owner}/${args.repo}.`,
          error,
        );
        return { status: "retry" };
      }
    },
  });
}

type ForgejoRepoApi = {
  has_releases?: boolean | null;
  release_counter?: number | null;
};

const TAG_COMMIT_METADATA_CONCURRENCY = 4;

function firstNonBlankString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function mapForgejoRelease(
  release: ForgejoReleaseApi,
  baseUrl: string,
  owner: string,
  repo: string,
): GithubRelease {
  const generatedHtmlUrl = `${baseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(release.tag_name)}`;
  return {
    id: release.id,
    html_url:
      typeof release.html_url === "string" && release.html_url.trim()
        ? release.html_url
        : generatedHtmlUrl,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    created_at: release.created_at,
    published_at: release.published_at,
    prerelease: !!release.prerelease,
    draft: !!release.draft,
  };
}

async function fetchForgejoProviderLatestRelease(
  providerLabel: ForgejoProviderLabel,
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  allowedRedirectBaseUrl: string | null,
  baseUrl: string,
  owner: string,
  repo: string,
): Promise<{ release: GithubRelease | null; error: FetchError | null }> {
  const chain = buildForgejoAuthChain(headersWithoutAuth, authToken);
  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<ForgejoReleaseApi>(
      `${apiBaseUrl}/releases/latest`,
      chain,
      {
        description: `${providerLabel} provider-latest release for ${owner}/${repo}`,
        allowedRedirectBaseUrl: allowedRedirectBaseUrl ?? undefined,
      },
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
      `${providerLabel} provider-latest endpoint failed for ${owner}/${repo}: ${response.status} ${response.statusText}`,
    );
    return { release: null, error };
  }

  return {
    release: data ? mapForgejoRelease(data, baseUrl, owner, repo) : null,
    error: null,
  };
}

function extractForgejoTagCommitSha(tag: ForgejoTagApi): string | undefined {
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

async function tryFetchForgejoCommitMessage(
  providerLabel: ForgejoProviderLabel,
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  allowedRedirectBaseUrl: string | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const encodedRef = encodeURIComponent(refOrSha);
  const candidates = [
    `${apiBaseUrl}/commits/${encodedRef}`,
    `${apiBaseUrl}/git/commits/${encodedRef}`,
  ];

  const chain = buildForgejoAuthChain(headersWithoutAuth, authToken);
  const metadata: { message?: string; date?: string } = {};

  for (const url of candidates) {
    try {
      const { response, data } =
        await fetchJsonResponseWithRetryAuthChain<ForgejoCommitApi>(
          url,
          chain,
          {
            description: `${providerLabel} commit (${refOrSha})`,
            allowedRedirectBaseUrl: allowedRedirectBaseUrl ?? undefined,
          },
        );
      if (!response.ok) {
        await discardResponseWithTimeout(response);
        continue;
      }
      if (!data) continue;

      const message = firstNonBlankString(data.message, data.commit?.message);
      const date = firstNonBlankString(
        data.created,
        data.author?.date,
        data.committer?.date,
        data.commit?.author?.date,
        data.commit?.committer?.date,
      )?.trim();

      metadata.message ??= message;
      metadata.date ??= date;
      if (metadata.message && metadata.date) return metadata;
    } catch {
      // best-effort only
    }
  }

  return metadata.message || metadata.date ? metadata : null;
}

async function fetchForgejoRepoInfo(
  providerLabel: ForgejoProviderLabel,
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  allowedRedirectBaseUrl: string | null,
  owner: string,
  repo: string,
): Promise<
  | { ok: true; data: ForgejoRepoApi }
  | {
      ok: false;
      status: number;
      statusText: string;
      retryAfter: string | null;
    }
> {
  const chain = buildForgejoAuthChain(headersWithoutAuth, authToken);

  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<ForgejoRepoApi>(
      apiBaseUrl,
      chain,
      {
        description: `${providerLabel} repo info for ${owner}/${repo}`,
        allowedRedirectBaseUrl: allowedRedirectBaseUrl ?? undefined,
      },
    );

  if (!response.ok) {
    const status = response.status;
    const statusText = response.statusText;
    const retryAfter = response.headers.get("retry-after");
    await discardResponseWithTimeout(response);
    return {
      ok: false,
      status,
      statusText,
      retryAfter,
    };
  }

  return { ok: true, data: data ?? {} };
}

export async function fetchLatestReleaseFromForgejoBase(args: {
  baseUrl: string;
  repoId: string;
  providerLabel: ForgejoProviderLabel;
  authToken: string | null;
  allowedRedirectBaseUrl: string | null;
  owner: string;
  repo: string;
  repoSettings: RepoSettingsForFetch;
  globalSettings: AppSettings;
  locale: Locale;
}): Promise<LatestReleaseFetchResult> {
  const {
    baseUrl,
    repoId,
    providerLabel,
    authToken,
    allowedRedirectBaseUrl,
    owner,
    repo,
    repoSettings,
    globalSettings,
    locale,
  } = args;
  log.info(`Fetching ${providerLabel} release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const filters = resolveEffectiveRepoFilters(repoSettings, globalSettings);
  const { effectiveReleaseSelectionStrategy, totalReleasesToFetch } = filters;

  const API_BASE_URL = `${baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const MAX_PER_PAGE = 50;
  const pagesToFetch = resolvePageCount(totalReleasesToFetch, MAX_PER_PAGE);
  const releasePagesToFetch =
    effectiveReleaseSelectionStrategy === "provider_latest" ? 1 : pagesToFetch;
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;
  let providerLatestRelease: GithubRelease | null | undefined;
  let tagFallbackReason: string | undefined;
  const commitRefsByTag = new Map<string, string>();
  const commitMetadataAttemptedTags = new Set<string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  try {
    if (effectiveReleaseSelectionStrategy === "provider_latest") {
      const providerLatestResult = await fetchForgejoProviderLatestRelease(
        providerLabel,
        API_BASE_URL,
        headersWithoutAuth,
        authToken,
        allowedRedirectBaseUrl,
        baseUrl,
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

      const url = `${API_BASE_URL}/releases?limit=${releasesOnThisPage}&page=${page}`;

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

      const chain = buildForgejoAuthChain(currentHeadersWithoutAuth, authToken);

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<ForgejoReleaseApi[]>(
          url,
          chain,
          {
            description: `${providerLabel} releases for ${owner}/${repo} page ${page}`,
            allowedRedirectBaseUrl: allowedRedirectBaseUrl ?? undefined,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          return notModifiedResult(repoId, repoSettings.etag);
        }
      }

      if (!response.ok) {
        await discardResponseWithTimeout(response);
        if (response.status === 404) {
          // Codeberg (Gitea/Forgejo) may return 404 on the releases endpoint if releases are disabled,
          // even though the repository exists and tags are available.
          if (page === 1) {
            const repoInfo = await fetchForgejoRepoInfo(
              providerLabel,
              API_BASE_URL,
              headersWithoutAuth,
              authToken,
              allowedRedirectBaseUrl,
              owner,
              repo,
            );

            if (repoInfo.ok) {
              tagFallbackReason = "releases_endpoint_404";
              break;
            }

            if (repoInfo.status === 404) {
              log.error(
                `${providerLabel} API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`,
              );
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }

            if (
              repoInfo.status === 429 ||
              (repoInfo.status === 403 && repoInfo.retryAfter)
            ) {
              log.error(
                `${providerLabel} API rate limit exceeded while probing ${owner}/${repo}. Retry-After: ${repoInfo.retryAfter ?? "N/A"}.`,
              );
              return {
                release: null,
                error: { type: "rate_limit" },
                newEtag,
              };
            }

            log.error(
              `${providerLabel} API error for ${owner}/${repo}: ${repoInfo.status} ${repoInfo.statusText}`,
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
            `${providerLabel} API rate limit exceeded for ${owner}/${repo}. Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `${providerLabel} API error for ${owner}/${repo}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `${providerLabel} API returned an empty body for ${owner}/${repo} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases.map((release) =>
          mapForgejoRelease(release, baseUrl, owner, repo),
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
        `${providerLabel} releases unavailable for ${repoId} (reason=${reason}). Falling back to tags.`,
      );

      let tagsResponse: Response | null = null;
      const tags: ForgejoTagApi[] = [];
      let tagPaginationFailed = false;
      let tagPaginationRateLimited = false;
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
        const tagCandidates = [
          {
            url: `${API_BASE_URL}/tags?limit=${tagsOnThisPage}&page=${page}`,
            unpaginated: false,
          },
          {
            url: `${API_BASE_URL}/tags?per_page=${tagsOnThisPage}&page=${page}`,
            unpaginated: false,
          },
          ...(page === 1
            ? [{ url: `${API_BASE_URL}/tags`, unpaginated: true }]
            : []),
        ];
        let pageTags: ForgejoTagApi[] | null = null;
        let usedUnpaginatedEndpoint = false;

        for (const candidate of tagCandidates) {
          try {
            const tagChain = buildForgejoAuthChain(
              headersWithoutAuth,
              authToken,
            );

            const result = await fetchJsonResponseWithRetryAuthChain<
              ForgejoTagApi[]
            >(candidate.url, tagChain, {
              description: `${providerLabel} tags for ${owner}/${repo} page ${page}`,
              allowedRedirectBaseUrl: allowedRedirectBaseUrl ?? undefined,
            });

            tagsResponse = result.response;
            if (!tagsResponse.ok) {
              const rateLimited = isRateLimitedResponse(tagsResponse);
              await discardResponseWithTimeout(tagsResponse);
              if (rateLimited) {
                tagPaginationRateLimited = true;
                break;
              }
              continue;
            }

            if (!result.data) continue;
            pageTags = result.data;
            usedUnpaginatedEndpoint = candidate.unpaginated;
            break;
          } catch {
            // Try the next candidate URL
          }
        }

        if (tagPaginationRateLimited) {
          tagPaginationFailed = true;
          break;
        }
        if (!pageTags) {
          tagPaginationFailed = true;
          break;
        }
        const remainingTags = Math.max(0, totalReleasesToFetch - tags.length);
        const tagsToAccept = usedUnpaginatedEndpoint
          ? remainingTags
          : Math.min(tagsOnThisPage, remainingTags);
        tags.push(...pageTags.slice(0, tagsToAccept));
        if (
          usedUnpaginatedEndpoint ||
          tags.length >= totalReleasesToFetch ||
          pageTags.length < tagsOnThisPage
        ) {
          break;
        }
      }

      if (tagPaginationFailed) {
        const errorType: FetchError["type"] =
          tagPaginationRateLimited || isRateLimitedResponse(tagsResponse)
            ? "rate_limit"
            : "api_error";
        log.error(
          tags.length > 0
            ? `${providerLabel} tag pagination failed for ${owner}/${repo}. Refusing to select from partial results.`
            : `Failed to fetch tags for ${repoId} after failing to find releases.`,
        );
        return { release: null, error: { type: errorType }, newEtag };
      }

      if (tags.length === 0) {
        log.info(`No tags found for ${repoId}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const t = await getTranslations({ locale, namespace: "Actions" });
      allReleases = tags.map((tag) => {
        const commitRef = extractForgejoTagCommitSha(tag);
        if (commitRef) commitRefsByTag.set(tag.name, commitRef);
        const tagMessage = firstNonBlankString(tag.message) ?? null;
        const tagDate = firstNonBlankString(tag.commit?.created)?.trim();
        return {
          id: 0,
          html_url: `${baseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/src/tag/${encodeURIComponent(tag.name)}`,
          tag_name: tag.name,
          name: `Tag: ${tag.name}`,
          body: tagMessage
            ? buildFallbackMarkdown(t("tag_message_fallback_title"), tagMessage)
            : "",
          created_at: tagDate ?? fetchedAtTimestamp,
          published_at: tagDate ?? fetchedAtTimestamp,
          published_at_unknown: !tagDate,
          prerelease: false,
          draft: false,
        };
      });

      const matchesEffectiveFilters = createEffectiveReleaseMatcher(
        filters,
        repoId,
      );
      const releasesMissingDates = allReleases.filter(
        (release) =>
          release.published_at_unknown && matchesEffectiveFilters(release),
      );
      await mapWithConcurrency(
        releasesMissingDates,
        TAG_COMMIT_METADATA_CONCURRENCY,
        async (release) => {
          commitMetadataAttemptedTags.add(release.tag_name);
          const commit = await tryFetchForgejoCommitMessage(
            providerLabel,
            API_BASE_URL,
            headersWithoutAuth,
            authToken,
            allowedRedirectBaseUrl,
            commitRefsByTag.get(release.tag_name) ?? release.tag_name,
          );
          applyCommitMetadata(
            release,
            commit,
            t("commit_message_fallback_title"),
          );
        },
      );
    }

    const latestRelease = selectLatestMatchingRelease({
      releases: allReleases,
      filters,
      repoIdForLog: repoId,
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
      (latestRelease.published_at_unknown ||
        !latestRelease.body ||
        latestRelease.body.trim() === "") &&
      !commitMetadataAttemptedTags.has(latestRelease.tag_name)
    ) {
      const commit = await tryFetchForgejoCommitMessage(
        providerLabel,
        API_BASE_URL,
        headersWithoutAuth,
        authToken,
        allowedRedirectBaseUrl,
        commitRefsByTag.get(latestRelease.tag_name) ?? latestRelease.tag_name,
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
        resolveForgejoCommitLinks({
          allowedRedirectBaseUrl,
          apiBaseUrl: API_BASE_URL,
          authToken,
          baseUrl,
          candidates,
          deadline,
          headersWithoutAuth,
          owner,
          providerLabel,
          repo,
        }),
    });

    return releaseSuccessResult(latestRelease, newEtag, fetchedAtTimestamp);
  } catch (error) {
    log.error(
      `Failed to fetch ${providerLabel} releases for ${owner}/${repo}:`,
      error,
    );
    return { release: null, error: { type: "api_error" }, newEtag: null };
  }
}

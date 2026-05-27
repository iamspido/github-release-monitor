import { getTranslations } from "next-intl/server";
import { buildCodebergAuthChain } from "@/lib/releases/auth-chains";
import { fetchJsonResponseWithRetryAuthChain } from "@/lib/releases/fetch";
import {
  isPreReleaseByTagName,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type { AppSettings, GithubRelease } from "@/types";
import { allPreReleaseTypes } from "@/types";

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
      if (!response.ok || !data) continue;

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

      if (message) return { message, date };
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
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
    };
  }

  return { ok: true, data: data ?? {} };
}

export async function fetchLatestReleaseFromCodeberg(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  log.info(`Fetching Codeberg release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

  const CODEBERG_API_BASE_URL = `https://codeberg.org/api/v1/repos/${owner}/${repo}`;
  const MAX_PER_PAGE = 50;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;
  let tagFallbackReason: string | undefined;

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const codebergToken = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);

  try {
    for (let page = 1; page <= pagesToFetch; page++) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${CODEBERG_API_BASE_URL}/releases?limit=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      if (page === 1 && repoSettings.etag) {
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
          log.info(`[ETag] No changes for codeberg:${owner}/${repo}.`);
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
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
        ...pageReleases.map((r) => ({
          id: r.id,
          html_url:
            r.html_url ??
            `https://codeberg.org/${owner}/${repo}/releases/tag/${r.tag_name}`,
          tag_name: r.tag_name,
          name: r.name,
          body: r.body,
          created_at: r.created_at,
          published_at: r.published_at,
          prerelease: !!r.prerelease,
          draft: !!r.draft,
        })),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      const reason = tagFallbackReason ?? "no_formal_releases";
      log.info(
        `Codeberg releases unavailable for codeberg:${owner}/${repo} (reason=${reason}). Falling back to tags.`,
      );

      const tagUrls = [
        `${CODEBERG_API_BASE_URL}/tags?limit=1&page=1`,
        `${CODEBERG_API_BASE_URL}/tags?per_page=1&page=1`,
        `${CODEBERG_API_BASE_URL}/tags`,
      ];

      let tagsResponse: Response | null = null;
      let tags: CodebergTagApi[] | undefined;

      for (const tagUrl of tagUrls) {
        try {
          const tagChain = buildCodebergAuthChain(
            headersWithoutAuth,
            codebergToken,
          );

          const result = await fetchJsonResponseWithRetryAuthChain<
            CodebergTagApi[]
          >(tagUrl, tagChain, {
            description: `Codeberg tags for ${owner}/${repo}`,
          });

          tagsResponse = result.response;
          if (!tagsResponse.ok) {
            continue;
          }

          const received = result.data ?? [];
          if (received.length > 0) {
            tags = received;
            break;
          }
        } catch {
          // Try the next candidate URL
        }
      }

      if (!tagsResponse?.ok) {
        log.error(
          `Failed to fetch tags for codeberg:${owner}/${repo} after failing to find releases.`,
        );
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      if (!tags || tags.length === 0) {
        log.info(`No tags found for codeberg:${owner}/${repo}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const latestTag = tags[0];
      const t = await getTranslations({ locale, namespace: "Actions" });

      let bodyContent = "";
      let publicationDate = new Date().toISOString();

      const sha = extractCodebergTagCommitSha(latestTag);
      if (sha) {
        const commit = await tryFetchCodebergCommitMessage(
          CODEBERG_API_BASE_URL,
          headersWithoutAuth,
          codebergToken,
          sha,
        );
        if (commit?.message) {
          bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
        }
        if (commit?.date) {
          publicationDate = commit.date;
        }
      }

      if (!bodyContent && typeof latestTag.message === "string") {
        bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${latestTag.message}`;
      }

      const virtualRelease: GithubRelease = {
        id: 0,
        html_url: `https://codeberg.org/${owner}/${repo}/src/tag/${latestTag.name}`,
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

    const filteredReleases = allReleases.filter((r) => {
      try {
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, "i");
          if (exclude.test(r.tag_name)) return false;
        }
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, "i");
          return include.test(r.tag_name);
        }
      } catch (e) {
        log.error(
          `Invalid regex for repo codeberg:${owner}/${repo}. Regex filters will be ignored. Error:`,
          e,
        );
      }

      if (r.draft) {
        return effectiveReleaseChannels.includes("draft");
      }

      const isTagMarkedPreRelease = isPreReleaseByTagName(
        r.tag_name,
        allPreReleaseTypes,
      );
      const isConsideredPreRelease = r.prerelease || isTagMarkedPreRelease;

      if (isConsideredPreRelease) {
        if (!effectiveReleaseChannels.includes("prerelease")) return false;

        // If the tag explicitly includes a pre-release marker (e.g. -beta/-rc),
        // apply the configured sub-channel filter. Otherwise, fall back to the API flag.
        if (isTagMarkedPreRelease) {
          return isPreReleaseByTagName(
            r.tag_name,
            effectivePreReleaseSubChannels,
          );
        }

        return true;
      }

      return effectiveReleaseChannels.includes("stable");
    });

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      const commit = await tryFetchCodebergCommitMessage(
        CODEBERG_API_BASE_URL,
        headersWithoutAuth,
        codebergToken,
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
    log.error(`Failed to fetch Codeberg releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

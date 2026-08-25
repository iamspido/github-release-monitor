import { fetchLatestReleaseFromForgejoBase } from "@/lib/releases/forgejo-base";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import {
  buildForgejoRepoId,
  getAllowedForgejoBaseUrls,
  getForgejoAccessTokenForBaseUrl,
  normalizeForgejoBaseUrl,
} from "@/lib/repositories/providers";
import type { AppSettings, Locale } from "@/types";

export async function fetchLatestReleaseFromForgejo(
  forgejoBaseUrl: string,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: Locale,
): Promise<LatestReleaseFetchResult> {
  const baseUrl = normalizeForgejoBaseUrl(forgejoBaseUrl);
  if (!baseUrl || !getAllowedForgejoBaseUrls().includes(baseUrl)) {
    return { release: null, error: { type: "invalid_url" }, newEtag: null };
  }
  return fetchLatestReleaseFromForgejoBase({
    baseUrl,
    repoId: buildForgejoRepoId(baseUrl, owner, repo),
    providerLabel: "Forgejo",
    authToken: getForgejoAccessTokenForBaseUrl(baseUrl),
    allowedRedirectBaseUrl: baseUrl,
    owner,
    repo,
    repoSettings,
    globalSettings,
    locale,
  });
}

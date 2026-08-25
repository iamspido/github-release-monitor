import { fetchLatestReleaseFromForgejoBase } from "@/lib/releases/forgejo-base";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import { normalizeEnvToken } from "@/lib/server-action-helpers";
import type { AppSettings, Locale } from "@/types";

export async function fetchLatestReleaseFromCodeberg(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: Locale,
): Promise<LatestReleaseFetchResult> {
  return fetchLatestReleaseFromForgejoBase({
    baseUrl: "https://codeberg.org",
    repoId: `codeberg:${owner}/${repo}`.toLowerCase(),
    providerLabel: "Codeberg",
    authToken: normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN),
    allowedRedirectBaseUrl: null,
    owner,
    repo,
    repoSettings,
    globalSettings,
    locale,
  });
}

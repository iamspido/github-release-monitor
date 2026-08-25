import { unstable_cache } from "next/cache";
import { fetchLatestReleaseFromCodeberg } from "@/lib/releases/codeberg";
import { fetchLatestReleaseFromForgejo } from "@/lib/releases/forgejo";
import { fetchLatestReleaseFromGitHub } from "@/lib/releases/github";
import { fetchLatestReleaseFromGitLab } from "@/lib/releases/gitlab";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import type { RepoProvider } from "@/lib/repositories/providers";
import { getEffectiveCacheIntervalMinutes } from "@/lib/runtime/repository-schedule";
import type { AppSettings, Locale } from "@/types";

export async function fetchLatestReleaseWithCache(
  provider: RepoProvider,
  providerLocation: string | undefined,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: Locale,
  options?: { skipCache?: boolean },
): Promise<LatestReleaseFetchResult> {
  const fetcher =
    provider === "github"
      ? fetchLatestReleaseFromGitHub
      : provider === "gitlab"
        ? (
            ownerArg: string,
            repoArg: string,
            repoSettingsArg: RepoSettingsForFetch,
            globalSettingsArg: AppSettings,
            localeArg: Locale,
          ) =>
            fetchLatestReleaseFromGitLab(
              providerLocation ?? "gitlab.com",
              ownerArg,
              repoArg,
              repoSettingsArg,
              globalSettingsArg,
              localeArg,
            )
        : provider === "forgejo"
          ? (
              ownerArg: string,
              repoArg: string,
              repoSettingsArg: RepoSettingsForFetch,
              globalSettingsArg: AppSettings,
              localeArg: Locale,
            ) =>
              fetchLatestReleaseFromForgejo(
                providerLocation ?? "",
                ownerArg,
                repoArg,
                repoSettingsArg,
                globalSettingsArg,
                localeArg,
              )
          : fetchLatestReleaseFromCodeberg;

  const cacheIntervalMinutes = getEffectiveCacheIntervalMinutes(
    repoSettings,
    globalSettings,
  );

  if (cacheIntervalMinutes <= 0 || options?.skipCache) {
    return fetcher(owner, repo, repoSettings, globalSettings, locale);
  }

  const cacheIntervalSeconds = cacheIntervalMinutes * 60;

  const effectiveReleasesPerPage =
    typeof repoSettings.releasesPerPage === "number" &&
    repoSettings.releasesPerPage >= 1 &&
    repoSettings.releasesPerPage <= 1000
      ? repoSettings.releasesPerPage
      : globalSettings.releasesPerPage;
  const effectiveReleaseSelectionStrategy =
    repoSettings.releaseSelectionStrategy ??
    globalSettings.releaseSelectionStrategy ??
    "newest";

  const cacheKeyPrefix =
    provider === "github"
      ? "github-release"
      : provider === "gitlab"
        ? `gitlab-release-${providerLocation ?? "gitlab.com"}`
        : provider === "forgejo"
          ? `forgejo-release-${providerLocation ?? "invalid"}`
          : "codeberg-release";

  const cacheTag =
    provider === "github"
      ? "github-releases"
      : provider === "gitlab"
        ? "gitlab-releases"
        : provider === "forgejo"
          ? "forgejo-releases"
          : "codeberg-releases";

  const cachedFetch = unstable_cache(
    (
      providerArg,
      providerHostArg,
      ownerArg,
      repoArg,
      repoSettingsArg,
      globalSettingsArg,
      localeArg,
    ) =>
      providerArg === "github"
        ? fetchLatestReleaseFromGitHub(
            ownerArg,
            repoArg,
            repoSettingsArg,
            globalSettingsArg,
            localeArg,
          )
        : providerArg === "gitlab"
          ? fetchLatestReleaseFromGitLab(
              providerHostArg,
              ownerArg,
              repoArg,
              repoSettingsArg,
              globalSettingsArg,
              localeArg,
            )
          : providerArg === "forgejo"
            ? fetchLatestReleaseFromForgejo(
                providerHostArg,
                ownerArg,
                repoArg,
                repoSettingsArg,
                globalSettingsArg,
                localeArg,
              )
            : fetchLatestReleaseFromCodeberg(
                ownerArg,
                repoArg,
                repoSettingsArg,
                globalSettingsArg,
                localeArg,
              ),
    [
      cacheKeyPrefix,
      provider,
      providerLocation ?? (provider === "gitlab" ? "gitlab.com" : ""),
      owner,
      repo,
      locale,
      JSON.stringify(repoSettings),
      String(effectiveReleasesPerPage),
      effectiveReleaseSelectionStrategy,
      String(cacheIntervalMinutes),
    ],
    {
      revalidate: cacheIntervalSeconds,
      tags: [cacheTag],
    },
  );

  return cachedFetch(
    provider,
    providerLocation ?? (provider === "gitlab" ? "gitlab.com" : ""),
    owner,
    repo,
    repoSettings,
    globalSettings,
    locale,
  );
}

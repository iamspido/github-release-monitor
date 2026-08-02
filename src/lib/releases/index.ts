import { mapWithConcurrency } from "@/lib/concurrency";
import { fetchLatestReleaseWithCache } from "@/lib/releases/cache";
import {
  resolveParallelRepoFetches,
  toGithubReleaseFromCache,
} from "@/lib/releases/filters";
import {
  hasAnyForgejoToken,
  hasAnyGitlabTokenForAllowedHosts,
  parseSupportedRepoUrl,
} from "@/lib/repositories/providers";
import { toRepositorySettingsSnapshot } from "@/lib/repositories/settings-snapshot";
import { log } from "@/lib/server-action-helpers";
import type { AppSettings, EnrichedRelease, Locale, Repository } from "@/types";

export async function getLatestReleasesForRepos(
  repositories: Repository[],
  settings: AppSettings,
  locale: Locale,
  options?: { skipCache?: boolean },
): Promise<EnrichedRelease[]> {
  if (repositories.length === 0) {
    return [];
  }

  const configuredParallel = resolveParallelRepoFetches(settings);
  const effectiveBatchSize = Math.min(configuredParallel, repositories.length);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const forgejoTokenConfigured = hasAnyForgejoToken();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Fetching ${repositories.length} repositories with parallel batch size ${effectiveBatchSize} (configured=${configuredParallel}, GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, Forgejo token=${forgejoTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const buildEnrichedRelease = async (
    repo: Repository,
  ): Promise<EnrichedRelease> => {
    const repoSettings = toRepositorySettingsSnapshot(repo);
    const { displayName: _displayName, ...fetchOverrides } = repoSettings;
    const fetchRepoSettings = {
      ...fetchOverrides,
      etag: repo.etag,
      latestRelease: repo.latestRelease,
    };

    const parsed = parseSupportedRepoUrl(repo.url);
    const storedAsForgejo = repo.id.startsWith("forgejo:");
    if (
      !parsed ||
      (storedAsForgejo &&
        (parsed.provider !== "forgejo" || parsed.id !== repo.id))
    ) {
      log.warn(`Skipping invalid repository URL for repoId=${repo.id}`);
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: "invalid_url" },
        isNew: repo.isNew,
        repoSettings,
      };
    }

    const {
      release: latestRelease,
      error,
      newEtag,
    } = await fetchLatestReleaseWithCache(
      parsed.provider,
      parsed.providerBaseUrl ?? parsed.providerHost,
      parsed.owner,
      parsed.repo,
      fetchRepoSettings,
      settings,
      locale,
      options,
    );

    if (error?.type === "not_modified") {
      const reconstructedRelease = toGithubReleaseFromCache(
        repo.latestRelease,
        new Date().toISOString(),
      );

      return {
        repoId: repo.id,
        repoUrl: repo.url,
        release: reconstructedRelease,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    if (error) {
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    if (!latestRelease) {
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: "api_error" },
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    return {
      repoId: repo.id,
      repoUrl: repo.url,
      release: latestRelease,
      isNew: repo.isNew,
      repoSettings: repoSettings,
      newEtag: newEtag,
    };
  };

  return mapWithConcurrency(
    repositories,
    effectiveBatchSize,
    buildEnrichedRelease,
  );
}

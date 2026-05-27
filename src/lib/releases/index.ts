import { fetchLatestReleaseWithCache } from "@/lib/releases/cache";
import { resolveParallelRepoFetches } from "@/lib/releases/filters";
import {
  hasAnyGitlabTokenForAllowedHosts,
  parseSupportedRepoUrl,
} from "@/lib/repositories/providers";
import { log } from "@/lib/server-action-helpers";
import type {
  AppSettings,
  CachedRelease,
  EnrichedRelease,
  GithubRelease,
  Repository,
} from "@/types";

export async function getLatestReleasesForRepos(
  repositories: Repository[],
  settings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean },
): Promise<EnrichedRelease[]> {
  if (repositories.length === 0) {
    return [];
  }

  const configuredParallel = resolveParallelRepoFetches(settings);
  const effectiveBatchSize = Math.min(configuredParallel, repositories.length);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Fetching ${repositories.length} repositories with parallel batch size ${effectiveBatchSize} (configured=${configuredParallel}, GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const buildEnrichedRelease = async (
    repo: Repository,
  ): Promise<EnrichedRelease> => {
    const parsed = parseSupportedRepoUrl(repo.url);
    if (!parsed) {
      log.warn(`Skipping invalid repository URL for repoId=${repo.id}`);
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: "invalid_url" },
        isNew: repo.isNew,
      };
    }

    const repoSettings = {
      releaseChannels: repo.releaseChannels,
      preReleaseSubChannels: repo.preReleaseSubChannels,
      releasesPerPage: repo.releasesPerPage,
      refreshInterval: repo.refreshInterval,
      cacheInterval: repo.cacheInterval,
      backgroundCheckCron: repo.backgroundCheckCron,
      includeRegex: repo.includeRegex,
      excludeRegex: repo.excludeRegex,
      appriseTags: repo.appriseTags,
      appriseFormat: repo.appriseFormat,
      etag: repo.etag,
      latestRelease: repo.latestRelease,
    };

    const {
      release: latestRelease,
      error,
      newEtag,
    } = await fetchLatestReleaseWithCache(
      parsed.provider,
      parsed.providerHost,
      parsed.owner,
      parsed.repo,
      repoSettings,
      settings,
      locale,
      options,
    );

    if (error?.type === "not_modified") {
      const cached: CachedRelease | undefined = repo.latestRelease;
      const reconstructedRelease: GithubRelease | undefined = cached
        ? {
            ...cached,
            id: 0,
            prerelease: false,
            draft: false,
          }
        : undefined;

      if (reconstructedRelease) {
        reconstructedRelease.fetched_at = new Date().toISOString();
      }

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

  const results: EnrichedRelease[] = new Array(repositories.length);

  for (
    let start = 0;
    start < repositories.length;
    start += effectiveBatchSize
  ) {
    const batch = repositories.slice(start, start + effectiveBatchSize);
    await Promise.all(
      batch.map(async (repo, offset) => {
        const result = await buildEnrichedRelease(repo);
        results[start + offset] = result;
      }),
    );
  }

  return results;
}

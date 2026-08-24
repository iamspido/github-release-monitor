import { revalidatePath } from "next/cache";
import { getLatestReleasesForRepos } from "@/lib/releases";
import { resolveEffectiveRepoFilters } from "@/lib/releases/filters";
import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import { isValidRepoId } from "@/lib/repositories/validation";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { isRestrictedActionAllowed, log } from "@/lib/server-action-helpers";
import { setJobStatus } from "@/lib/storage/jobs";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings, Repository } from "@/types";

function createReleaseFetchFingerprint(
  repository: Repository,
  settings: AppSettings,
): string {
  const filters = resolveEffectiveRepoFilters(repository, settings);
  return JSON.stringify({
    url: repository.url,
    locale: settings.locale,
    releaseChannels: [...filters.effectiveReleaseChannels].sort(),
    preReleaseSubChannels: [...filters.effectivePreReleaseSubChannels].sort(),
    customPreReleaseMarkers: [
      ...filters.effectiveCustomPreReleaseMarkers,
    ].sort(),
    releaseSelectionStrategy: filters.effectiveReleaseSelectionStrategy,
    versionTagPattern: filters.versionTagPattern,
    releasesPerPage: filters.totalReleasesToFetch,
    includeRegex: filters.effectiveIncludeRegex,
    excludeRegex: filters.effectiveExcludeRegex,
    etag: repository.etag,
    latestRelease: repository.latestRelease,
  });
}

export async function refreshSingleRepositoryAction(repoId: string) {
  const snapshot = await scheduleTask(
    `refreshSingleRepositoryAction: ${repoId}`,
    async () => {
      if (!(await isRestrictedActionAllowed())) {
        return;
      }

      if (!isValidRepoId(repoId)) {
        log.error("Invalid repoId format for refresh:", repoId);
        return;
      }

      log.info(`Refreshing single repository: ${repoId}`);

      const settings = await getSettings();
      const allRepos = await getRepositories();
      const repository = allRepos.find((repo) => repo.id === repoId);

      if (!repository) {
        log.error(`Repository ${repoId} not found for refresh.`);
        return;
      }

      return {
        repository,
        settings,
        fingerprint: createReleaseFetchFingerprint(repository, settings),
      };
    },
  );

  if (!snapshot) return;

  const enrichedReleases = await getLatestReleasesForRepos(
    [snapshot.repository],
    snapshot.settings,
    snapshot.settings.locale,
    { skipCache: true },
  );
  const enrichedRelease = enrichedReleases[0];
  if (!enrichedRelease) {
    log.error(`Failed to get release for ${repoId} during single refresh.`);
    return;
  }

  return scheduleTask(`commitRefreshSingleRepository: ${repoId}`, async () => {
    const [allRepos, currentSettings] = await Promise.all([
      getRepositories(),
      getSettings(),
    ]);
    const repoIndex = allRepos.findIndex((repo) => repo.id === repoId);
    if (repoIndex === -1) return;

    if (
      snapshot.fingerprint !==
      createReleaseFetchFingerprint(allRepos[repoIndex], currentSettings)
    ) {
      log.info(
        `Skipped stale single refresh result for ${repoId} because its effective fetch inputs changed.`,
      );
      return;
    }

    applyReleaseFetchResultToRepository(allRepos[repoIndex], enrichedRelease, {
      initializeLastSeenFromFetchedRelease: true,
    });

    await saveRepositories(allRepos);
    revalidatePath("/");
  });
}

export async function refreshMultipleRepositoriesAction(
  repoIds: string[],
  jobId: string,
) {
  try {
    log.info(
      `Refresh multiple repositories start: count=${repoIds.length} jobId=${jobId}`,
    );
    const settings = await getSettings();
    const locale = settings.locale;
    const allRepos = await getRepositories();
    const reposToRefresh = allRepos.filter((r) => repoIds.includes(r.id));

    if (reposToRefresh.length > 0) {
      const fetchFingerprints = new Map(
        reposToRefresh.map((repository) => [
          repository.id,
          createReleaseFetchFingerprint(repository, settings),
        ]),
      );
      const enrichedReleases = await getLatestReleasesForRepos(
        reposToRefresh,
        settings,
        locale,
        { skipCache: true },
      );

      const enrichedMap = new Map(enrichedReleases.map((r) => [r.repoId, r]));
      await scheduleTask(
        `commitRefreshMultipleRepositories: ${jobId}`,
        async () => {
          // Re-read after the network phase so concurrent deletes, imports, and
          // unrelated settings changes are preserved. Results whose effective
          // fetch inputs changed are left for the next refresh.
          const currentRepos = await getRepositories();
          const currentSettings = await getSettings();
          for (const repo of currentRepos) {
            const enriched = enrichedMap.get(repo.id);
            const fetchFingerprint = fetchFingerprints.get(repo.id);
            if (
              enriched &&
              fetchFingerprint ===
                createReleaseFetchFingerprint(repo, currentSettings)
            ) {
              applyReleaseFetchResultToRepository(repo, enriched, {
                initializeLastSeenFromFetchedRelease: true,
              });
            } else if (enriched && fetchFingerprint) {
              log.info(
                `Skipped stale background refresh result for ${repo.id} because its effective fetch inputs changed.`,
              );
            }
          }
          await saveRepositories(currentRepos);
        },
      );
    }
    setJobStatus(jobId, "complete");
    log.info(`Refresh multiple repositories complete: jobId=${jobId}`);
  } catch (error) {
    log.error(`[Job ${jobId}] Failed to refresh repositories:`, error);
    setJobStatus(jobId, "error");
  }
}

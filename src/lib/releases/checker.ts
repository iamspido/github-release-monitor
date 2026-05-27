import { sendNotification } from "@/lib/notifications";
import { getLatestReleasesForRepos } from "@/lib/releases";
import {
  applyEtagUpdate,
  canReplaceCachedReleaseWithVirtual,
  resolveParallelRepoFetches,
  toCachedRelease,
} from "@/lib/releases/filters";
import { hasAnyGitlabTokenForAllowedHosts } from "@/lib/repositories/providers";
import { filterRepositoriesDueForBackgroundCheck } from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { log } from "@/lib/server-action-helpers";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";

async function _checkForNewReleasesUnscheduled(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  log.info(`Running check for new releases...`);
  const settings = await getSettings();
  const backgroundCheckStartedAt = new Date();
  const backgroundCheckStartedAtIso = backgroundCheckStartedAt.toISOString();
  const effectiveLocale = options?.overrideLocale || settings.locale;
  const parallelLimit = resolveParallelRepoFetches(settings);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Parallel fetch batch size set to ${parallelLimit} (GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const originalRepos = await getRepositories();
  if (originalRepos.length === 0) {
    log.info(`No repositories to check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const reposToCheck = options?.onlyDue
    ? filterRepositoriesDueForBackgroundCheck(
        originalRepos,
        settings,
        backgroundCheckStartedAt,
      )
    : originalRepos;

  if (reposToCheck.length === 0) {
    log.info(`No repositories are due for background check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    reposToCheck,
    settings,
    effectiveLocale,
    { skipCache: options?.skipCache },
  );

  const updatedRepos = [...originalRepos];
  let changed = false;
  let notificationsSent = 0;

  for (const enrichedRelease of enrichedReleases) {
    const repoIndex = updatedRepos.findIndex(
      (r) => r.id === enrichedRelease.repoId,
    );
    if (repoIndex === -1) continue;

    const repo = updatedRepos[repoIndex];
    let repoWasUpdated = false;

    if (
      options?.onlyDue &&
      repo.lastBackgroundCheckAt !== backgroundCheckStartedAtIso
    ) {
      repo.lastBackgroundCheckAt = backgroundCheckStartedAtIso;
      repoWasUpdated = true;
    }

    if (applyEtagUpdate(repo, enrichedRelease.newEtag)) {
      repoWasUpdated = true;
    }

    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0; // tag-fallback or reconstructed data
      const newCachedRelease = toCachedRelease(enrichedRelease.release);

      // Do not overwrite an existing real release with a virtual one.
      if (
        !isVirtual ||
        canReplaceCachedReleaseWithVirtual(repo.latestRelease)
      ) {
        if (
          JSON.stringify(repo.latestRelease) !==
          JSON.stringify(newCachedRelease)
        ) {
          repoWasUpdated = true;
        }
        repo.latestRelease = newCachedRelease;
      } else if (
        isVirtual &&
        repo.latestRelease &&
        newCachedRelease.fetched_at
      ) {
        // Still update the last successful fetch time when ETag says not modified
        if (repo.latestRelease.fetched_at !== newCachedRelease.fetched_at) {
          repo.latestRelease.fetched_at = newCachedRelease.fetched_at;
          repoWasUpdated = true;
        }
      }

      const newTag = enrichedRelease.release.tag_name;
      const isNewRelease =
        !isVirtual &&
        repo.lastSeenReleaseTag &&
        repo.lastSeenReleaseTag !== newTag;

      if (isNewRelease) {
        log.info(
          `New release detected for ${repo.id}: ${newTag} (previously ${repo.lastSeenReleaseTag})`,
        );

        const shouldHighlight = settings.showAcknowledge ?? true;
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = shouldHighlight;
        repoWasUpdated = true;

        try {
          await sendNotification(
            repo,
            enrichedRelease.release,
            effectiveLocale,
            settings,
          );
          notificationsSent++;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error ?? "unknown");
          log.error(
            `Failed to send notification for ${repo.id}. The release tag HAS been updated to prevent repeated failures for the same release. Error: ${message}`,
            error instanceof Error ? error : undefined,
          );
        }
      } else if (!repo.lastSeenReleaseTag && !isVirtual) {
        log.info(
          `First fetch for ${repo.id}, setting initial release tag to ${newTag}. No notification will be sent.`,
        );
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = false;
        repoWasUpdated = true;
      }
    }
    if (repoWasUpdated) {
      changed = true;
    }
  }

  if (changed) {
    log.info(`Found changes, updating repository data file.`);
    await saveRepositories(updatedRepos);
  } else {
    log.info(`No new releases found.`);
  }
  log.info(
    `Summary: notificationsSent=${notificationsSent} checked=${reposToCheck.length}`,
  );
  return { notificationsSent, checked: reposToCheck.length };
}

export async function checkForNewReleases(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  return scheduleTask("checkForNewReleases", () =>
    _checkForNewReleasesUnscheduled(options),
  );
}

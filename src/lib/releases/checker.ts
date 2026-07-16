import { getConfiguredNotificationChannels } from "@/lib/notifications";
import {
  applyPendingNotificationDeliveryOutcomes,
  attemptPendingNotifications,
  enqueuePendingNotification,
  pruneAbandonedNotifications,
} from "@/lib/notifications/pending-deliveries";
import { getLatestReleasesForRepos } from "@/lib/releases";
import { resolveParallelRepoFetches } from "@/lib/releases/filters";
import { hasAnyGitlabTokenForAllowedHosts } from "@/lib/repositories/providers";
import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import { scheduleProcessTask } from "@/lib/runtime/process-task-queue";
import { filterRepositoriesDueForBackgroundCheck } from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { log } from "@/lib/server-action-helpers";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings, EnrichedRelease, Repository } from "@/types";

async function applyReleaseCheckResults({
  originalRepos,
  enrichedReleases,
  settings,
  effectiveLocale,
  backgroundCheckStartedAtIso,
  markDueChecks,
  notificationChannels,
}: {
  originalRepos: Repository[];
  enrichedReleases: EnrichedRelease[];
  settings: AppSettings;
  effectiveLocale: string;
  backgroundCheckStartedAtIso: string;
  markDueChecks: boolean;
  notificationChannels: ReturnType<typeof getConfiguredNotificationChannels>;
}) {
  const updatedRepos = originalRepos.map((repository) => ({
    ...repository,
    pendingNotifications: repository.pendingNotifications?.map(
      (notification) => ({
        ...notification,
        channels: [...notification.channels],
      }),
    ),
  }));
  const repoIndexById = new Map(
    updatedRepos.map((repo, index) => [repo.id, index]),
  );
  let changed = false;

  for (const enrichedRelease of enrichedReleases) {
    const repoIndex = repoIndexById.get(enrichedRelease.repoId);
    if (repoIndex === undefined) continue;

    const repo = updatedRepos[repoIndex];
    let repoWasUpdated = false;

    if (
      markDueChecks &&
      repo.lastBackgroundCheckAt !== backgroundCheckStartedAtIso
    ) {
      repo.lastBackgroundCheckAt = backgroundCheckStartedAtIso;
      repoWasUpdated = true;
    }

    if (applyReleaseFetchResultToRepository(repo, enrichedRelease)) {
      repoWasUpdated = true;
    }

    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0; // tag-fallback or reconstructed data
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

        enqueuePendingNotification(
          repo,
          enrichedRelease.release,
          effectiveLocale,
          settings,
          notificationChannels,
        );
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

  return { updatedRepos, changed };
}

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
    return { checked: 0 };
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
    return { checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    reposToCheck,
    settings,
    effectiveLocale,
    { skipCache: options?.skipCache },
  );

  const notificationChannels = getConfiguredNotificationChannels();
  const { updatedRepos, changed } = await applyReleaseCheckResults({
    originalRepos,
    enrichedReleases,
    settings,
    effectiveLocale,
    backgroundCheckStartedAtIso,
    markDueChecks: options?.onlyDue === true,
    notificationChannels,
  });

  if (changed) {
    log.info(`Found changes, updating repository data file.`);
    await saveRepositories(updatedRepos);
  } else {
    log.info(`No new releases found.`);
  }

  return { checked: reposToCheck.length };
}

const NOTIFICATION_DELIVERY_QUEUE = "notification-delivery";

function processPendingNotifications(): Promise<number> {
  return scheduleProcessTask(NOTIFICATION_DELIVERY_QUEUE, async () => {
    // Network delivery deliberately happens outside the shared state scheduler.
    // Only the short merge/write phase is serialized with other state changes.
    const now = new Date();
    const snapshot = await getRepositories();
    const prunedSnapshot = pruneAbandonedNotifications(snapshot, now);
    const delivery = await attemptPendingNotifications(
      prunedSnapshot.repositories,
      now,
    );
    if (prunedSnapshot.changed || delivery.outcomes.length > 0) {
      await scheduleTask("persistNotificationDeliveryResults", async () => {
        const currentRepositories = await getRepositories();
        const applied = applyPendingNotificationDeliveryOutcomes(
          currentRepositories,
          delivery.outcomes,
        );
        const pruned = pruneAbandonedNotifications(applied.repositories, now);
        if (applied.changed || pruned.changed) {
          await saveRepositories(pruned.repositories);
        }
      });
    }
    return delivery.notificationsSent;
  });
}

export async function checkForNewReleases(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  const result = await scheduleTask("checkForNewReleases", () =>
    _checkForNewReleasesUnscheduled(options),
  );
  const notificationsSent = await processPendingNotifications();
  log.info(
    `Summary: notificationsSent=${notificationsSent} checked=${result.checked}`,
  );
  return { ...result, notificationsSent };
}

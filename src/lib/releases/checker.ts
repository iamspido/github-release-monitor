import { getConfiguredNotificationChannels } from "@/lib/notifications";
import {
  applyPendingNotificationDeliveryOutcomes,
  attemptPendingNotifications,
  enqueuePendingNotification,
  pruneAbandonedNotifications,
} from "@/lib/notifications/pending-deliveries";
import { getLatestReleasesForRepos } from "@/lib/releases";
import { resolveParallelRepoFetches } from "@/lib/releases/filters";
import {
  hasAnyForgejoToken,
  hasAnyGitlabTokenForAllowedHosts,
} from "@/lib/repositories/providers";
import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import { scheduleProcessTask } from "@/lib/runtime/process-task-queue";
import { filterRepositoriesDueForBackgroundCheck } from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { log } from "@/lib/server-action-helpers";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings, EnrichedRelease, Locale, Repository } from "@/types";

async function applyReleaseCheckResults({
  originalRepos,
  enrichedReleases,
  settings,
  effectiveLocale,
  backgroundCheckStartedAtIso,
  markDueChecks,
  notificationChannels,
  notificationBatchId,
}: {
  originalRepos: Repository[];
  enrichedReleases: EnrichedRelease[];
  settings: AppSettings;
  effectiveLocale: Locale;
  backgroundCheckStartedAtIso: string;
  markDueChecks: boolean;
  notificationChannels: ReturnType<typeof getConfiguredNotificationChannels>;
  notificationBatchId: string;
}) {
  const updatedRepos = originalRepos.map((repository) => ({
    ...repository,
    pendingNotifications: repository.pendingNotifications?.map(
      (notification) => ({
        ...notification,
        channels: [...notification.channels],
        channelStates: notification.channelStates
          ? Object.fromEntries(
              Object.entries(notification.channelStates).map(
                ([channel, state]) => [channel, { ...state }],
              ),
            )
          : undefined,
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
      const isReconstructed = enrichedRelease.error?.type === "not_modified";
      const newTag = enrichedRelease.release.tag_name;
      const isNewRelease =
        !isReconstructed &&
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
          notificationBatchId,
        );
      } else if (!repo.lastSeenReleaseTag && !isReconstructed) {
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
  overrideLocale?: Locale;
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
  const forgejoTokenConfigured = hasAnyForgejoToken();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Parallel fetch batch size set to ${parallelLimit} (GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, Forgejo token=${forgejoTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
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
  const notificationBatchId = crypto.randomUUID();
  const { updatedRepos, changed } = await applyReleaseCheckResults({
    originalRepos,
    enrichedReleases,
    settings,
    effectiveLocale,
    backgroundCheckStartedAtIso,
    markDueChecks: options?.onlyDue === true,
    notificationChannels,
    notificationBatchId,
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
    const [snapshot, settings] = await Promise.all([
      getRepositories(),
      getSettings(),
    ]);
    const prunedSnapshot = pruneAbandonedNotifications(snapshot, now);
    const delivery = await attemptPendingNotifications(
      prunedSnapshot.repositories,
      now,
      settings,
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
  overrideLocale?: Locale;
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

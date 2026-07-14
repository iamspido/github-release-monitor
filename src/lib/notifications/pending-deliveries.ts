import { logger } from "@/lib/logger";
import {
  NotificationDeliveryError,
  sendNotification,
} from "@/lib/notifications";
import type {
  AppSettings,
  GithubRelease,
  NotificationChannel,
  PendingReleaseNotification,
  Repository,
} from "@/types";

const INITIAL_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60_000;
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 10;
export const MAX_NOTIFICATION_DELIVERIES_PER_RUN = 20;
export const NOTIFICATION_DELIVERY_CONCURRENCY = 4;

type NotificationDeliveryOutcome = {
  repositoryId: string;
  notificationId: string;
  attemptedChannels: NotificationChannel[];
  previousAttempts: number;
  status: "sent" | "failed";
  failedChannels?: NotificationChannel[];
  attempts?: number;
  nextAttemptAt?: string;
  abandonedAt?: string;
};

export function enqueuePendingNotification(
  repository: Repository,
  release: GithubRelease,
  locale: string,
  settings: AppSettings,
  channels: NotificationChannel[],
): boolean {
  if (channels.length === 0) {
    logger
      .withScope("Notifications")
      .warn(
        `No notification services (SMTP or Apprise) are configured. Skipping notification for ${repository.id}.`,
      );
    return false;
  }

  const id = `${encodeURIComponent(repository.id)}:${encodeURIComponent(
    release.tag_name,
  )}`;
  const existing = repository.pendingNotifications?.find(
    (notification) => notification.id === id,
  );
  if (existing) {
    existing.channels = Array.from(
      new Set([...existing.channels, ...channels]),
    );
    return false;
  }

  const notification: PendingReleaseNotification = {
    id,
    repository: {
      id: repository.id,
      url: repository.url,
      appriseTags: repository.appriseTags,
      appriseFormat: repository.appriseFormat,
    },
    release: { ...release },
    locale,
    settings: {
      timeFormat: settings.timeFormat,
      appriseMaxCharacters: settings.appriseMaxCharacters,
      appriseTags: settings.appriseTags,
      appriseFormat: settings.appriseFormat,
    },
    channels: [...channels],
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  repository.pendingNotifications = [
    ...(repository.pendingNotifications ?? []),
    notification,
  ];
  return true;
}

function isDueForDelivery(
  notification: PendingReleaseNotification,
  nowMs: number,
): boolean {
  if (
    notification.abandonedAt ||
    notification.attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS
  ) {
    return false;
  }
  const nextAttemptMs = notification.nextAttemptAt
    ? Date.parse(notification.nextAttemptAt)
    : Number.NEGATIVE_INFINITY;
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
}

export async function attemptPendingNotifications(
  repositories: Repository[],
  now = new Date(),
): Promise<{
  outcomes: NotificationDeliveryOutcome[];
  notificationsSent: number;
}> {
  const nowMs = now.getTime();
  const candidates = repositories
    .flatMap((repository) =>
      (repository.pendingNotifications ?? []).map((notification) => ({
        repositoryId: repository.id,
        notification,
      })),
    )
    .filter(({ notification }) => isDueForDelivery(notification, nowMs))
    .slice(0, MAX_NOTIFICATION_DELIVERIES_PER_RUN);
  const outcomes = new Array<NotificationDeliveryOutcome>(candidates.length);
  let nextCandidateIndex = 0;

  async function worker() {
    while (nextCandidateIndex < candidates.length) {
      const candidateIndex = nextCandidateIndex++;
      const { repositoryId, notification } = candidates[candidateIndex];
      const attemptedChannels = [...notification.channels];
      try {
        await sendNotification(
          notification.repository,
          notification.release,
          notification.locale,
          notification.settings,
          attemptedChannels,
        );
        outcomes[candidateIndex] = {
          repositoryId,
          notificationId: notification.id,
          attemptedChannels,
          previousAttempts: notification.attempts,
          status: "sent",
        };
      } catch (error: unknown) {
        const failedChannels =
          error instanceof NotificationDeliveryError
            ? error.failedChannels
            : attemptedChannels;
        const attempts = notification.attempts + 1;
        const abandoned = attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS;
        const retryDelay = Math.min(
          INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempts - 1, 16),
          MAX_RETRY_DELAY_MS,
        );
        outcomes[candidateIndex] = {
          repositoryId,
          notificationId: notification.id,
          attemptedChannels,
          previousAttempts: notification.attempts,
          status: "failed",
          failedChannels: [...failedChannels],
          attempts,
          nextAttemptAt: abandoned
            ? undefined
            : new Date(nowMs + retryDelay).toISOString(),
          abandonedAt: abandoned ? now.toISOString() : undefined,
        };
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        logger
          .withScope("Notifications")
          .error(
            abandoned
              ? `Notification delivery for ${repositoryId} ${notification.release.tag_name} failed permanently after ${attempts} attempts. Error: ${message}`
              : `Notification delivery for ${repositoryId} ${notification.release.tag_name} failed; retry ${attempts} is scheduled. Error: ${message}`,
            error instanceof Error ? error : undefined,
          );
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(NOTIFICATION_DELIVERY_CONCURRENCY, candidates.length),
      },
      () => worker(),
    ),
  );

  return {
    outcomes,
    notificationsSent: outcomes.filter((outcome) => outcome.status === "sent")
      .length,
  };
}

export function applyPendingNotificationDeliveryOutcomes(
  repositories: Repository[],
  outcomes: NotificationDeliveryOutcome[],
): { repositories: Repository[]; changed: boolean } {
  if (outcomes.length === 0) {
    return { repositories, changed: false };
  }

  const outcomesByRepository = new Map<string, NotificationDeliveryOutcome[]>();
  for (const outcome of outcomes) {
    const existing = outcomesByRepository.get(outcome.repositoryId) ?? [];
    existing.push(outcome);
    outcomesByRepository.set(outcome.repositoryId, existing);
  }

  let changed = false;
  const updatedRepositories = repositories.map((repository) => {
    const repositoryOutcomes = outcomesByRepository.get(repository.id);
    if (!repositoryOutcomes || !repository.pendingNotifications?.length) {
      return repository;
    }
    const outcomesById = new Map(
      repositoryOutcomes.map((outcome) => [outcome.notificationId, outcome]),
    );
    const remaining: PendingReleaseNotification[] = [];

    for (const notification of repository.pendingNotifications) {
      const outcome = outcomesById.get(notification.id);
      // Do not apply a stale result if another delivery attempt already changed
      // this entry while the network request was in flight.
      if (!outcome || notification.attempts !== outcome.previousAttempts) {
        remaining.push(notification);
        continue;
      }

      const unattemptedChannels = notification.channels.filter(
        (channel) => !outcome.attemptedChannels.includes(channel),
      );
      if (outcome.status === "sent") {
        changed = true;
        if (unattemptedChannels.length > 0) {
          remaining.push({
            ...notification,
            channels: unattemptedChannels,
            nextAttemptAt: undefined,
          });
        }
        continue;
      }

      changed = true;
      remaining.push({
        ...notification,
        channels: Array.from(
          new Set([...unattemptedChannels, ...(outcome.failedChannels ?? [])]),
        ),
        attempts: outcome.attempts ?? notification.attempts + 1,
        nextAttemptAt: outcome.nextAttemptAt,
        abandonedAt: outcome.abandonedAt,
      });
    }

    return {
      ...repository,
      pendingNotifications: remaining.length > 0 ? remaining : undefined,
    };
  });

  return { repositories: updatedRepositories, changed };
}

export async function deliverPendingNotifications(
  repositories: Repository[],
  now = new Date(),
): Promise<{
  repositories: Repository[];
  changed: boolean;
  notificationsSent: number;
}> {
  const delivery = await attemptPendingNotifications(repositories, now);
  const applied = applyPendingNotificationDeliveryOutcomes(
    repositories,
    delivery.outcomes,
  );
  return {
    ...applied,
    notificationsSent: delivery.notificationsSent,
  };
}

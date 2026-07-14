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

export async function deliverPendingNotifications(
  repositories: Repository[],
  now = new Date(),
): Promise<{
  repositories: Repository[];
  changed: boolean;
  notificationsSent: number;
}> {
  let changed = false;
  let notificationsSent = 0;
  const nowMs = now.getTime();
  const updatedRepositories = repositories.map((repository) => ({
    ...repository,
    pendingNotifications: repository.pendingNotifications?.map(
      (notification) => ({
        ...notification,
        channels: [...notification.channels],
      }),
    ),
  }));

  for (const repository of updatedRepositories) {
    const pending = repository.pendingNotifications;
    if (!pending?.length) continue;

    const remaining: PendingReleaseNotification[] = [];
    for (const notification of pending) {
      const nextAttemptMs = notification.nextAttemptAt
        ? Date.parse(notification.nextAttemptAt)
        : Number.NEGATIVE_INFINITY;
      if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) {
        remaining.push(notification);
        continue;
      }

      try {
        await sendNotification(
          notification.repository,
          notification.release,
          notification.locale,
          notification.settings,
          notification.channels,
        );
        changed = true;
        notificationsSent++;
      } catch (error: unknown) {
        const failedChannels =
          error instanceof NotificationDeliveryError
            ? error.failedChannels
            : notification.channels;
        const attempts = notification.attempts + 1;
        const retryDelay = Math.min(
          INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempts - 1, 16),
          MAX_RETRY_DELAY_MS,
        );
        remaining.push({
          ...notification,
          channels: [...failedChannels],
          attempts,
          nextAttemptAt: new Date(nowMs + retryDelay).toISOString(),
        });
        changed = true;
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        logger
          .withScope("Notifications")
          .error(
            `Notification delivery for ${repository.id} ${notification.release.tag_name} failed; retry ${attempts} is scheduled. Error: ${message}`,
            error instanceof Error ? error : undefined,
          );
      }
    }

    repository.pendingNotifications =
      remaining.length > 0 ? remaining : undefined;
  }

  return { repositories: updatedRepositories, changed, notificationsSent };
}

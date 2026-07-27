import { logger } from "@/lib/logger";
import {
  sendAppriseNotification,
  sendTestAppriseNotification,
} from "@/lib/notifications/apprise";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import { sendNewReleaseEmail } from "@/lib/notifications/email";
import type {
  GithubRelease,
  Locale,
  NotificationChannel,
  NotificationSettings,
  Repository,
} from "@/types";

export { sendTestAppriseNotification };

export class NotificationDeliveryError extends Error {
  constructor(
    readonly failedChannels: NotificationChannel[],
    options?: ErrorOptions,
  ) {
    super("One or more notification services failed to send.", options);
    this.name = "NotificationDeliveryError";
  }
}

export function getConfiguredNotificationChannels(): NotificationChannel[] {
  const { isSmtpConfigured, isAppriseConfigured } =
    getNotificationRuntimeConfig();
  const channels: NotificationChannel[] = [];
  if (isSmtpConfigured) channels.push("email");
  if (isAppriseConfigured) channels.push("apprise");
  return channels;
}

export async function sendNotification(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  settings: NotificationSettings,
  requestedChannels = getConfiguredNotificationChannels(),
) {
  const { isAppriseConfigured } = getNotificationRuntimeConfig();
  const notifications: Array<{
    channel: NotificationChannel;
    promise: Promise<void>;
  }> = [];

  if (requestedChannels.includes("email")) {
    notifications.push({
      channel: "email",
      promise: sendNewReleaseEmail(
        repository,
        release,
        locale,
        settings.timeFormat,
      ),
    });
  }

  if (requestedChannels.includes("apprise")) {
    notifications.push({
      channel: "apprise",
      promise: isAppriseConfigured
        ? sendAppriseNotification(repository, release, locale, settings)
        : Promise.reject(new Error("Apprise is no longer configured.")),
    });
  }

  if (notifications.length === 0) {
    logger
      .withScope("Notifications")
      .warn(
        `No notification services (SMTP or Apprise) are configured. Skipping notification for ${repository.id}.`,
      );
    return;
  }

  const results = await Promise.allSettled(
    notifications.map(({ promise }) => promise),
  );
  const failedChannels = results.flatMap((result, index) =>
    result.status === "rejected" ? [notifications[index].channel] : [],
  );
  if (failedChannels.length > 0) {
    throw new NotificationDeliveryError(failedChannels, {
      cause: new AggregateError(
        results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      ),
    });
  }
}

import { logger } from "@/lib/logger";
import {
  sendAppriseNotification,
  sendTestAppriseNotification,
} from "@/lib/notifications/apprise";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import { sendNewReleaseEmail } from "@/lib/notifications/email";
import type { AppSettings, GithubRelease, Repository } from "@/types";

export { sendTestAppriseNotification };

export async function sendNotification(
  repository: Repository,
  release: GithubRelease,
  locale: string,
  settings: AppSettings,
) {
  const { hasMailHost, isAppriseConfigured } = getNotificationRuntimeConfig();
  const notificationPromises: Array<Promise<void>> = [];

  if (hasMailHost) {
    notificationPromises.push(
      sendNewReleaseEmail(repository, release, locale, settings.timeFormat),
    );
  }

  if (isAppriseConfigured) {
    notificationPromises.push(
      sendAppriseNotification(repository, release, locale, settings),
    );
  }

  if (notificationPromises.length === 0) {
    logger
      .withScope("Notifications")
      .warn(
        `No notification services (SMTP or Apprise) are configured. Skipping notification for ${repository.id}.`,
      );
    return;
  }

  const results = await Promise.allSettled(notificationPromises);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    throw new Error("One or more notification services failed to send.");
  }
}

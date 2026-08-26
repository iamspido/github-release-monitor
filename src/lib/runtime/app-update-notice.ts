import { logger } from "@/lib/logger";
import { compareAppVersions } from "@/lib/runtime/app-version";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { runApplicationUpdateCheck } from "@/lib/runtime/update-check";
import { isRestrictedActionAllowed } from "@/lib/server-action-helpers";
import {
  getSystemStatus,
  updateSystemStatus,
} from "@/lib/storage/system-status";
import type { SystemStatus, UpdateNotificationState } from "@/types";

function getPendingSecurityVersion(
  status: SystemStatus,
  currentVersion: string,
): string | null {
  const candidate =
    status.latestSecurityVersion ??
    (status.latestReleaseIsSecurity === true
      ? status.latestKnownVersion
      : null);

  return compareAppVersions(candidate, currentVersion) === 1 ? candidate : null;
}

export async function getUpdateNotificationState(): Promise<UpdateNotificationState> {
  const status = await getSystemStatus();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const latestVersion = status.latestKnownVersion;
  const latestReleaseTitle = status.latestReleaseTitle;
  const latestSecurityVersion = getPendingSecurityVersion(
    status,
    currentVersion,
  );
  const hasUpdate = compareAppVersions(latestVersion, currentVersion) === 1;

  const isDismissed =
    hasUpdate &&
    typeof status.dismissedVersion === "string" &&
    status.dismissedVersion === latestVersion;

  return {
    latestVersion,
    latestReleaseTitle,
    latestSecurityVersion,
    currentVersion,
    lastCheckedAt: status.lastCheckedAt,
    lastCheckError: status.lastCheckError,
    hasUpdate,
    isDismissed,
    isSecurityUpdate: hasUpdate && latestSecurityVersion !== null,
    shouldNotify: hasUpdate && !isDismissed,
  };
}

export async function getUpdateNotificationStateOrFallback(): Promise<UpdateNotificationState> {
  try {
    return await getUpdateNotificationState();
  } catch (error) {
    logger
      .withScope("UpdateCheck")
      .error("Could not load the optional update notification state.", error);
    return {
      latestVersion: null,
      latestReleaseTitle: null,
      latestSecurityVersion: null,
      currentVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
      lastCheckedAt: null,
      lastCheckError: "read_error",
      hasUpdate: false,
      isDismissed: false,
      isSecurityUpdate: false,
      shouldNotify: false,
    };
  }
}

export async function dismissUpdateNotificationAction(
  expectedVersion: string,
  expectedSecurityVersion: string | null,
): Promise<{
  success: boolean;
}> {
  return scheduleTask("dismissUpdateNotification", async () => {
    if (
      !expectedVersion ||
      (expectedSecurityVersion !== null &&
        typeof expectedSecurityVersion !== "string") ||
      !(await isRestrictedActionAllowed())
    ) {
      return { success: false };
    }

    let didDismiss = false;
    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
    await updateSystemStatus((current) => {
      const currentSecurityVersion = getPendingSecurityVersion(
        current,
        currentVersion,
      );
      if (
        current.latestKnownVersion !== expectedVersion ||
        currentSecurityVersion !== expectedSecurityVersion
      ) {
        return current;
      }
      didDismiss = true;
      return {
        ...current,
        dismissedVersion: expectedVersion,
      };
    });
    return { success: didDismiss };
  });
}

export async function triggerAppUpdateCheckAction(): Promise<{
  success: boolean;
  notice: UpdateNotificationState;
}> {
  return scheduleTask("triggerAppUpdateCheck", async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, notice: await getUpdateNotificationState() };
    }

    await updateSystemStatus((current) => ({
      ...current,
      dismissedVersion: null,
    }));

    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
    await runApplicationUpdateCheck(currentVersion);
    const notice = await getUpdateNotificationState();
    return { success: true, notice };
  });
}

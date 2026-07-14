import { logger } from "@/lib/logger";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { runApplicationUpdateCheck } from "@/lib/runtime/update-check";
import { isRestrictedActionAllowed } from "@/lib/server-action-helpers";
import {
  getSystemStatus,
  updateSystemStatus,
} from "@/lib/storage/system-status";
import type { UpdateNotificationState } from "@/types";

type ParsedVersion = {
  core: [number, number, number];
  prerelease: string[];
};

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^v/i, "").replace(/\+.*$/, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(
    normalized,
  );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < a.core.length; i += 1) {
    const segmentA = a.core[i];
    const segmentB = b.core[i];
    if (segmentA > segmentB) return 1;
    if (segmentA < segmentB) return -1;
  }

  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const identifierA = a.prerelease[i];
    const identifierB = b.prerelease[i];
    if (identifierA === undefined) return -1;
    if (identifierB === undefined) return 1;
    if (identifierA === identifierB) continue;

    const numericA = /^\d+$/.test(identifierA);
    const numericB = /^\d+$/.test(identifierB);
    if (numericA && numericB) {
      return Number(identifierA) > Number(identifierB) ? 1 : -1;
    }
    if (numericA !== numericB) return numericA ? -1 : 1;
    return identifierA > identifierB ? 1 : -1;
  }

  return 0;
}

export async function getUpdateNotificationState(): Promise<UpdateNotificationState> {
  const status = await getSystemStatus();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const latestVersion = status.latestKnownVersion;
  const normalizedCurrent = parseVersion(currentVersion);
  const normalizedLatest = parseVersion(latestVersion);

  let hasUpdate = false;

  if (normalizedCurrent && normalizedLatest) {
    hasUpdate =
      compareParsedVersions(normalizedLatest, normalizedCurrent) === 1;
  }

  const isDismissed =
    hasUpdate &&
    typeof status.dismissedVersion === "string" &&
    status.dismissedVersion === latestVersion;

  return {
    latestVersion,
    currentVersion,
    lastCheckedAt: status.lastCheckedAt,
    lastCheckError: status.lastCheckError,
    hasUpdate,
    isDismissed,
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
      currentVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
      lastCheckedAt: null,
      lastCheckError: "read_error",
      hasUpdate: false,
      isDismissed: false,
      shouldNotify: false,
    };
  }
}

export async function dismissUpdateNotificationAction(): Promise<{
  success: boolean;
}> {
  return scheduleTask("dismissUpdateNotification", async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false };
    }

    await updateSystemStatus((current) => {
      const latestVersion = current.latestKnownVersion;
      if (!latestVersion) {
        return {
          ...current,
          dismissedVersion: null,
        };
      }
      return {
        ...current,
        dismissedVersion: latestVersion,
      };
    });
    return { success: true };
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

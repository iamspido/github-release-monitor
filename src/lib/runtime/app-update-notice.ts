import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { runApplicationUpdateCheck } from "@/lib/runtime/update-check";
import { isRestrictedActionAllowed } from "@/lib/server-action-helpers";
import {
  getSystemStatus,
  updateSystemStatus,
} from "@/lib/storage/system-status";
import type { UpdateNotificationState } from "@/types";

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^v/i, "").replace(/\+.*$/, "");
}

function compareSemanticVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core, preRelease] = version.split("-", 2);
    const parts = core.split(".").map((part) => {
      const numeric = Number(part);
      return Number.isNaN(numeric) ? 0 : numeric;
    });
    return { parts, preRelease: preRelease ?? null };
  };

  const parsedA = parse(a);
  const parsedB = parse(b);
  const length = Math.max(parsedA.parts.length, parsedB.parts.length);

  for (let i = 0; i < length; i += 1) {
    const segmentA = parsedA.parts[i] ?? 0;
    const segmentB = parsedB.parts[i] ?? 0;
    if (segmentA > segmentB) return 1;
    if (segmentA < segmentB) return -1;
  }

  if (parsedA.preRelease && !parsedB.preRelease) return -1;
  if (!parsedA.preRelease && parsedB.preRelease) return 1;
  if (parsedA.preRelease && parsedB.preRelease) {
    if (parsedA.preRelease > parsedB.preRelease) return 1;
    if (parsedA.preRelease < parsedB.preRelease) return -1;
  }

  return 0;
}

export async function getUpdateNotificationState(): Promise<UpdateNotificationState> {
  const status = await getSystemStatus();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const latestVersion = status.latestKnownVersion;
  const normalizedCurrent = normalizeVersion(currentVersion);
  const normalizedLatest = normalizeVersion(latestVersion);

  let hasUpdate = false;

  if (normalizedCurrent && normalizedLatest) {
    hasUpdate =
      compareSemanticVersions(normalizedLatest, normalizedCurrent) === 1;
  } else if (latestVersion) {
    hasUpdate = latestVersion !== currentVersion;
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

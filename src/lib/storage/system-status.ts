import path from "node:path";
import { JsonFileStore } from "@/lib/storage/json-file-store";
import {
  assertJsonObject,
  assertOptionalField,
  isBoolean,
  isNullable,
  isString,
} from "@/lib/storage/runtime-validation";
import type { SystemStatus } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "system-status.json");

const defaultStatus: SystemStatus = {
  latestKnownVersion: null,
  latestReleaseTitle: null,
  latestReleaseIsSecurity: null,
  latestSecurityVersion: null,
  lastCheckedAt: null,
  dismissedVersion: null,
  lastCheckError: null,
};

function normalizeSystemStatus(value: unknown): SystemStatus {
  const persisted = assertJsonObject(value, "System status data");
  for (const key of Object.keys(defaultStatus)) {
    if (key === "latestReleaseIsSecurity") {
      assertOptionalField(
        persisted,
        key,
        isNullable(isBoolean),
        "a boolean or null",
      );
      continue;
    }
    assertOptionalField(
      persisted,
      key,
      isNullable(isString),
      "a string or null",
    );
  }
  return {
    ...defaultStatus,
    ...(persisted as Partial<SystemStatus>),
  };
}

const systemStatusStore = new JsonFileStore<SystemStatus>({
  filePath: dataFilePath,
  defaultValue: defaultStatus,
  scope: "SystemStatus",
  parse: normalizeSystemStatus,
  writeErrorMessage: "Could not persist system status.",
  initDirectoryErrorMessage:
    "Unable to initialize system status storage directory.",
  initFileErrorMessage: "Unable to initialize system status data file.",
});

let currentStatusUpdate: Promise<void> = Promise.resolve();

type SystemStatusListener = (status: SystemStatus) => void;
const systemStatusListeners = new Set<SystemStatusListener>();

export function subscribeToSystemStatus(
  listener: SystemStatusListener,
): () => void {
  systemStatusListeners.add(listener);
  return () => {
    systemStatusListeners.delete(listener);
  };
}

function notifySystemStatusListeners(status: SystemStatus): void {
  for (const listener of systemStatusListeners) {
    try {
      listener(status);
    } catch (error) {
      console.error("System status listener failed:", error);
    }
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return systemStatusStore.read();
}

export async function saveSystemStatus(status: SystemStatus): Promise<void> {
  await systemStatusStore.write(normalizeSystemStatus(status));
  notifySystemStatusListeners(status);
}

export async function updateSystemStatus(
  updater: (current: SystemStatus) => SystemStatus | Promise<SystemStatus>,
): Promise<SystemStatus> {
  const updatePromise = currentStatusUpdate.then(async () => {
    const current = await getSystemStatus();
    const updated = await updater(current);
    await saveSystemStatus(updated);
    return updated;
  });
  currentStatusUpdate = updatePromise.then(
    () => undefined,
    () => undefined,
  );
  return updatePromise;
}

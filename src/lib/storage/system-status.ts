import path from "node:path";
import { JsonFileStore } from "@/lib/storage/json-file-store";
import {
  assertJsonObject,
  assertOptionalField,
  isNullable,
  isString,
} from "@/lib/storage/runtime-validation";
import type { SystemStatus } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "system-status.json");

const defaultStatus: SystemStatus = {
  latestKnownVersion: null,
  lastCheckedAt: null,
  latestEtag: null,
  dismissedVersion: null,
  lastCheckError: null,
};

function normalizeSystemStatus(value: unknown): SystemStatus {
  const persisted = assertJsonObject(value, "System status data");
  for (const key of Object.keys(defaultStatus)) {
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

export async function getSystemStatus(): Promise<SystemStatus> {
  return systemStatusStore.read();
}

export async function saveSystemStatus(status: SystemStatus): Promise<void> {
  await systemStatusStore.write(normalizeSystemStatus(status));
}

export async function updateSystemStatus(
  updater: (current: SystemStatus) => SystemStatus | Promise<SystemStatus>,
): Promise<SystemStatus> {
  const current = await getSystemStatus();
  const updated = await updater(current);
  await saveSystemStatus(updated);
  return updated;
}

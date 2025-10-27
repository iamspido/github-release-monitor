"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import type { SystemStatus } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "system-status.json");
const dataDirPath = path.dirname(dataFilePath);
const log = logger.withScope("SystemStatus");

const defaultStatus: SystemStatus = {
  latestKnownVersion: null,
  lastCheckedAt: null,
  latestEtag: null,
  dismissedVersion: null,
  lastCheckError: null,
};

async function ensureDataFileExists() {
  try {
    await fs.mkdir(dataDirPath, { recursive: true });
  } catch (error) {
    log.error(
      `Failed to create system status data directory at ${dataDirPath}:`,
      error,
    );
    throw new Error("Unable to initialize system status storage directory.");
  }

  try {
    await fs.access(dataFilePath);
  } catch {
    try {
      await fs.writeFile(
        dataFilePath,
        JSON.stringify(defaultStatus, null, 2),
        "utf8",
      );
      log.info(`Created system status data file at: ${dataFilePath}`);
    } catch (error) {
      log.error(
        `Failed to write initial system status data file at ${dataFilePath}:`,
        error,
      );
      throw new Error("Unable to initialize system status data file.");
    }
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  await ensureDataFileExists();
  try {
    const raw = await fs.readFile(dataFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SystemStatus>;
    return {
      ...defaultStatus,
      ...parsed,
    };
  } catch (error) {
    log.error("Failed to read system-status.json:", error);
    return { ...defaultStatus, lastCheckError: "read_error" };
  }
}

export async function saveSystemStatus(status: SystemStatus): Promise<void> {
  await ensureDataFileExists();
  try {
    const merged: SystemStatus = {
      ...defaultStatus,
      ...status,
    };
    await fs.writeFile(dataFilePath, JSON.stringify(merged, null, 2), "utf8");
  } catch (error) {
    log.error("Failed to write system-status.json:", error);
    throw new Error("Could not persist system status.");
  }
}

export async function updateSystemStatus(
  updater: (current: SystemStatus) => SystemStatus | Promise<SystemStatus>,
): Promise<SystemStatus> {
  const current = await getSystemStatus();
  const updated = await updater(current);
  await saveSystemStatus(updated);
  return updated;
}

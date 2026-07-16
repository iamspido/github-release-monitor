import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "@/lib/logger";

const log = logger.withScope("Auth");

const dataDirPath = path.join(process.cwd(), "data");
export const authDbPath = path.join(dataDirPath, "auth.db");
let authDb: ReturnType<typeof openAuthDatabase> | null = null;

function getRuntimeIdentity() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  return `uid=${uid ?? "unknown"} gid=${gid ?? "unknown"}`;
}

function openAuthDatabase() {
  try {
    mkdirSync(dataDirPath, { recursive: true });
    return new Database(authDbPath);
  } catch (error) {
    log.error(
      `Failed to open Better Auth SQLite database at '${authDbPath}'. Ensure '${dataDirPath}' exists and is writable by the container runtime user (${getRuntimeIdentity()}). For Docker bind mounts, the host data directory must be writable by UID/GID 1001.`,
      error,
    );
    throw error;
  }
}

export function getAuthDb() {
  if (!authDb) {
    authDb = openAuthDatabase();
  }
  return authDb;
}

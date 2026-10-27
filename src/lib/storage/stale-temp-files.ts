import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { isNodeErrorWithCode } from "@/lib/node-error";
import { DATA_TEMP_FILE_PATTERN } from "@/lib/storage/data-file-names";

const LOG_SCOPE = "DataCleanup";
const log = logger.withScope(LOG_SCOPE);

// A younger temporary file may still belong to a write of another process on
// the same volume, so only older leftovers are removed.
const STALE_TEMP_FILE_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * Removes temporary data files that an interrupted write left behind.
 *
 * The JSON stores and the version marker write a temporary file in the data
 * directory and rename it over the real file. A crash between the two steps
 * leaves the temporary file, and nothing else ever reads or removes it. Only
 * regular files directly in the data directory whose name matches
 * DATA_TEMP_FILE_PATTERN and whose mtime is older than 10 minutes are
 * unlinked. A failure logs a warning and the start goes on.
 */
export async function removeStaleTempFiles(): Promise<void> {
  const dataDirPath = path.join(process.cwd(), "data");

  let entryNames: string[];
  try {
    entryNames = await fs.readdir(dataDirPath);
  } catch (error) {
    // A first start has no data directory yet, so there is nothing to clean.
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      log.warn(
        `Failed to list the data directory at ${dataDirPath} for stale temporary files:`,
        error,
      );
    }
    return;
  }

  const now = Date.now();
  const removedNames: string[] = [];
  for (const entryName of entryNames) {
    if (!DATA_TEMP_FILE_PATTERN.test(entryName)) {
      continue;
    }
    const filePath = path.join(dataDirPath, entryName);
    try {
      const stats = await fs.lstat(filePath);
      if (
        !stats.isFile() ||
        now - stats.mtimeMs <= STALE_TEMP_FILE_MIN_AGE_MS
      ) {
        continue;
      }
      await fs.unlink(filePath);
      removedNames.push(entryName);
    } catch (error) {
      // A file that is already gone needs no cleanup.
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        log.warn(
          `Failed to remove stale temporary data file at ${filePath}:`,
          error,
        );
      }
    }
  }

  if (removedNames.length > 0) {
    log.info(
      `Removed stale temporary data files from ${dataDirPath}: ${removedNames.join(", ")}`,
    );
  }
}

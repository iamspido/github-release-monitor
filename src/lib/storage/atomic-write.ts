import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "@/lib/logger";
import { isNodeErrorWithCode } from "@/lib/node-error";
import { createTempFileName } from "@/lib/storage/data-file-names";

/**
 * Replaces `filePath` with `content` in one step that survives a crash or a
 * power loss. The content goes to a temporary file next to the target and is
 * flushed to disk before the file is renamed over the target, so a reader
 * never sees a half written file. The directory is flushed after the rename,
 * so the new name is on disk too. If a step before the rename fails, the
 * temporary file is removed and the original error is thrown again. A failed
 * removal only logs a warning through `log`.
 */
export async function writeFileAtomically(
  filePath: string,
  content: string,
  log: Logger,
): Promise<void> {
  const dirPath = path.dirname(filePath);
  const tempPath = path.join(
    dirPath,
    createTempFileName(path.basename(filePath)),
  );
  try {
    const handle = await fs.open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch (cleanupError) {
      log.warn(
        `Failed to remove temporary data file at ${tempPath}:`,
        cleanupError,
      );
    }
    throw error;
  }
  await syncDirectory(dirPath);
}

// Some platforms and file systems cannot open or flush a directory. The rename
// is done by then, so only the extra durability of the new name is lost.
async function syncDirectory(dirPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch (error) {
    if (
      isNodeErrorWithCode(error, "EINVAL") ||
      isNodeErrorWithCode(error, "EISDIR")
    ) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

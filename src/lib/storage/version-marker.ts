import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { writeFileAtomically } from "@/lib/storage/atomic-write";
import { VERSION_MARKER_FILE_NAME } from "@/lib/storage/data-file-names";

const log = logger.withScope("VersionMarker");

// A final release version such as 2.6.1. Prereleases, build metadata and the
// 0.0.0 fallback for a missing version do not count.
const FINAL_RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Records the running application version in the data directory.
 *
 * A later upgrade checks this file. Every start of this release rewrites it.
 * It names the last 2.6.1 or later release that started with a writable data
 * directory. It only records that this release started. Only a final release
 * version is written. Any other version keeps the existing file and logs a
 * warning. A failure logs a warning and the start goes on.
 */
export async function writeVersionMarker(): Promise<void> {
  const dataDirPath = path.join(process.cwd(), "data");
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const markerPath = path.join(dataDirPath, VERSION_MARKER_FILE_NAME);

  if (!FINAL_RELEASE_VERSION.test(version) || version === "0.0.0") {
    log.warn(
      `Skipped writing the version marker at ${markerPath}, because the app version "${version}" is not a final release version. An existing marker stays unchanged.`,
    );
    return;
  }

  try {
    await fs.mkdir(dataDirPath, { recursive: true });
    await writeFileAtomically(
      markerPath,
      `${JSON.stringify({ version })}\n`,
      log,
    );
  } catch (error) {
    log.warn(
      `Failed to write the version marker at ${markerPath}. A later upgrade needs this file, so make sure the data directory is writable.`,
      error,
    );
  }
}

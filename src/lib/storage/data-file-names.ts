import { randomUUID } from "node:crypto";

// Names of the data files in the data directory and of the temporary files
// their atomic writes use. The stores, the version marker, the CLI and the
// start cleanup share them, so the names cannot drift apart when a file is
// renamed. This module only depends on Node.js built-ins, so the cleanup and
// the CLI can import it without loading the stores.
export const SETTINGS_FILE_NAME = "settings.json";
export const REPOSITORIES_FILE_NAME = "repositories.json";
export const SYSTEM_STATUS_FILE_NAME = "system-status.json";
export const VERSION_MARKER_FILE_NAME = "grm-version.json";

const DATA_FILE_NAMES = [
  VERSION_MARKER_FILE_NAME,
  SETTINGS_FILE_NAME,
  REPOSITORIES_FILE_NAME,
  SYSTEM_STATUS_FILE_NAME,
];

/**
 * Returns the name of the temporary file for one atomic write of `fileName`.
 * The writer creates `.<file>.<pid>.<uuid>.tmp` next to the file and renames
 * it over the file.
 */
export function createTempFileName(fileName: string): string {
  return `.${fileName}.${process.pid}.${randomUUID()}.tmp`;
}

// Matches exactly the names that createTempFileName() returns for the four
// data files above.
export const DATA_TEMP_FILE_PATTERN = new RegExp(
  `^\\.(?:${DATA_FILE_NAMES.map(escapeRegExp).join("|")})\\.\\d+\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp$`,
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

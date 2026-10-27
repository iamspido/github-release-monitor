import {
  createTempFileName,
  DATA_TEMP_FILE_PATTERN,
  REPOSITORIES_FILE_NAME,
  SETTINGS_FILE_NAME,
  SYSTEM_STATUS_FILE_NAME,
  VERSION_MARKER_FILE_NAME,
} from "@/lib/storage/data-file-names";

const DATA_FILE_NAMES = [
  "settings.json",
  "repositories.json",
  "system-status.json",
  "grm-version.json",
];

describe("storage/data-file-names", () => {
  it("names the four data files", () => {
    expect([
      SETTINGS_FILE_NAME,
      REPOSITORIES_FILE_NAME,
      SYSTEM_STATUS_FILE_NAME,
      VERSION_MARKER_FILE_NAME,
    ]).toEqual(DATA_FILE_NAMES);
  });

  it.each(DATA_FILE_NAMES)(
    "builds a temporary name for %s that the cleanup pattern matches",
    (fileName) => {
      const tempName = createTempFileName(fileName);

      expect(tempName).toMatch(
        new RegExp(
          `^\\.${fileName.replaceAll(".", "\\.")}\\.${process.pid}\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp$`,
        ),
      );
      expect(DATA_TEMP_FILE_PATTERN.test(tempName)).toBe(true);
    },
  );

  it("gives every write its own temporary name", () => {
    expect(createTempFileName(SETTINGS_FILE_NAME)).not.toBe(
      createTempFileName(SETTINGS_FILE_NAME),
    );
  });

  it("does not match temporary names of other files", () => {
    expect(DATA_TEMP_FILE_PATTERN.test(createTempFileName("jobs.json"))).toBe(
      false,
    );
    expect(DATA_TEMP_FILE_PATTERN.test(createTempFileName("auth.db"))).toBe(
      false,
    );
  });
});

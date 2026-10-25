// vitest globals enabled

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppSettings, Repository } from "@/types";

// Saving through the real actions keeps a refused pattern left as stored
// unchecked, but checks a changed pattern or a new security line.

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {} }),
}));
vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

const LOOKAHEAD_INCLUDE = "^(?!.*-rc)";
const LOOKAHEAD_EXCLUDE = "-(?!final)";
const LONG_FILTER = "a".repeat(513);
const STICKY_SECURITY = "security\n/cve/y";
const LOOKAHEAD_VERSION = "^v(?<version>\\d+\\.\\d+)(?!-rc)";

let dataDir: string;
let cwdSpy: { mockRestore: () => void };

beforeEach(async () => {
  vi.resetModules();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "grm-stored-patterns-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dataDir);
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function storeSettings(values: Partial<AppSettings>) {
  const { createDefaultSettings, saveSettings } = await import(
    "@/lib/storage/settings"
  );
  await saveSettings({ ...createDefaultSettings({}), ...values });
}

async function storedSettings() {
  const { getSettings } = await import("@/lib/storage/settings");
  const settings = await getSettings();
  return {
    releaseSortOrder: settings.releaseSortOrder,
    timeFormat: settings.timeFormat,
    includeRegex: settings.includeRegex,
    excludeRegex: settings.excludeRegex,
    customSecurityPatterns: settings.customSecurityPatterns,
  };
}

const STORED_PATTERNS = {
  includeRegex: LONG_FILTER,
  excludeRegex: LOOKAHEAD_EXCLUDE,
  customSecurityPatterns: STICKY_SECURITY,
};

describe("saving the settings while refused patterns stay stored", () => {
  it("the sort order toggle saves and keeps the stored filters and security patterns as stored", async () => {
    await storeSettings({ ...STORED_PATTERNS, releaseSortOrder: "new_first" });
    const { updateSettingsPatchAction } = await import(
      "@/app/settings/actions"
    );

    const result = await updateSettingsPatchAction({
      releaseSortOrder: "repo_az",
    });

    expect({ success: result.success, stored: await storedSettings() }).toEqual(
      {
        success: true,
        stored: {
          ...STORED_PATTERNS,
          releaseSortOrder: "repo_az",
          timeFormat: "24h",
        },
      },
    );
  });

  it("a save of the whole form that leaves the patterns as stored, apart from surrounding spaces, keeps them", async () => {
    await storeSettings(STORED_PATTERNS);
    const { getSettings } = await import("@/lib/storage/settings");
    const { updateSettingsAction } = await import("@/app/settings/actions");

    const result = await updateSettingsAction({
      ...(await getSettings()),
      timeFormat: "12h",
      excludeRegex: `  ${LOOKAHEAD_EXCLUDE} `,
      customSecurityPatterns: `${STICKY_SECURITY}\n`,
    });

    expect({ success: result.success, stored: await storedSettings() }).toEqual(
      {
        success: true,
        stored: {
          ...STORED_PATTERNS,
          releaseSortOrder: "latest_first",
          timeFormat: "12h",
        },
      },
    );
  });

  it.each([
    [
      "the exclude filter",
      { excludeRegex: "-(?!beta)" },
      "regex_error_invalid",
    ],
    [
      "the include filter",
      { includeRegex: "b".repeat(513) },
      "regex_error_invalid",
    ],
    [
      "the security patterns",
      { customSecurityPatterns: `${STICKY_SECURITY}\n/(?<=CVE-)\\d+/` },
      "security_patterns_error_invalid",
    ],
  ])(
    "still refuses %s changed into another refused value and keeps the stored settings",
    async (_, change, description) => {
      await storeSettings(STORED_PATTERNS);
      const { updateSettingsPatchAction } = await import(
        "@/app/settings/actions"
      );

      const result = await updateSettingsPatchAction({
        ...change,
        timeFormat: "12h",
      });

      expect({ result, stored: await storedSettings() }).toEqual({
        result: {
          success: false,
          message: { title: "toast_error_title", description },
        },
        stored: {
          ...STORED_PATTERNS,
          releaseSortOrder: "latest_first",
          timeFormat: "24h",
        },
      });
    },
  );
});

const LOOKBEHIND_SECURITY_LINE = "/(?<=v)1\\.0/";
const STORED_SECURITY_LINES = `${LOOKBEHIND_SECURITY_LINE}\ncve`;

describe("saving the custom security lines while a refused line stays stored", () => {
  it("adds a keyword line and keeps the stored line the engine refuses", async () => {
    await storeSettings({ customSecurityPatterns: STORED_SECURITY_LINES });
    const { updateSettingsPatchAction } = await import(
      "@/app/settings/actions"
    );

    const result = await updateSettingsPatchAction({
      customSecurityPatterns: `${STORED_SECURITY_LINES}\nhotfix`,
    });

    expect({
      success: result.success,
      stored: (await storedSettings()).customSecurityPatterns,
    }).toEqual({
      success: true,
      stored: `${STORED_SECURITY_LINES}\nhotfix`,
    });
  });

  it("reads each stored line without surrounding whitespace and in any order, and checks only the new line", async () => {
    await storeSettings({ customSecurityPatterns: STORED_SECURITY_LINES });
    const { getSettings } = await import("@/lib/storage/settings");
    const { updateSettingsAction } = await import("@/app/settings/actions");
    const lines = `cve\r\n  ${LOOKBEHIND_SECURITY_LINE} \n/HF-\\d+/i`;

    const result = await updateSettingsAction({
      ...(await getSettings()),
      customSecurityPatterns: lines,
    });

    expect({
      success: result.success,
      stored: (await storedSettings()).customSecurityPatterns,
    }).toEqual({ success: true, stored: lines });
  });

  it.each([
    ["a stored line changed into another refused line", "/(?<=v)1\\.1/\ncve"],
    [
      "a new refused line next to the stored lines",
      `${STORED_SECURITY_LINES}\nhotfix\n/(?<!rc)\\d+/`,
    ],
  ])("still refuses %s and keeps the stored lines", async (_, lines) => {
    await storeSettings({ customSecurityPatterns: STORED_SECURITY_LINES });
    const { updateSettingsPatchAction } = await import(
      "@/app/settings/actions"
    );

    const result = await updateSettingsPatchAction({
      customSecurityPatterns: lines,
    });

    expect({
      result,
      stored: (await storedSettings()).customSecurityPatterns,
    }).toEqual({
      result: {
        success: false,
        message: {
          title: "toast_error_title",
          description: "security_patterns_error_invalid",
        },
      },
      stored: STORED_SECURITY_LINES,
    });
  });
});

const LEGACY: Repository = {
  id: "github:acme/legacy",
  url: "https://github.com/acme/legacy",
  includeRegex: LOOKAHEAD_INCLUDE,
  excludeRegex: LONG_FILTER,
  releaseSelectionStrategy: "highest_version",
  versionTagPattern: LOOKAHEAD_VERSION,
  lastSeenReleaseTag: "v1.2",
};

const LEGACY_DRAFT = {
  displayName: "",
  isPinned: true,
  releaseChannels: ["stable" as const],
  preReleaseSubChannels: undefined,
  customPreReleaseMarkers: undefined,
  releaseSelectionStrategy: "highest_version" as const,
  versionTagPattern: LOOKAHEAD_VERSION,
  releasesPerPage: null,
  refreshInterval: null,
  cacheInterval: null,
  backgroundCheckCron: null,
  includeRegex: LOOKAHEAD_INCLUDE,
  excludeRegex: LONG_FILTER,
  tags: [],
  appriseTags: undefined,
  appriseFormat: undefined,
};

async function storeRepositories(repositories: Repository[]) {
  const { saveRepositories } = await import("@/lib/storage/repositories");
  await saveRepositories(repositories);
}

async function storedLegacy() {
  const { getRepositories } = await import("@/lib/storage/repositories");
  const [repository] = await getRepositories();
  return {
    isPinned: repository.isPinned,
    includeRegex: repository.includeRegex,
    excludeRegex: repository.excludeRegex,
    versionTagPattern: repository.versionTagPattern,
    lastSeenReleaseTag: repository.lastSeenReleaseTag,
  };
}

describe("saving the repository settings while refused patterns stay stored", () => {
  it("the dialog pins the repository and keeps the stored filters and version tag pattern as stored", async () => {
    await storeRepositories([LEGACY]);
    const { updateRepositorySettingsAction } = await import("@/app/actions");

    const result = await updateRepositorySettingsAction(LEGACY.id, {
      ...LEGACY_DRAFT,
      excludeRegex: ` ${LONG_FILTER}  `,
    });

    expect({ result, stored: await storedLegacy() }).toEqual({
      result: { success: true },
      stored: {
        isPinned: true,
        includeRegex: LOOKAHEAD_INCLUDE,
        excludeRegex: LONG_FILTER,
        versionTagPattern: LOOKAHEAD_VERSION,
        lastSeenReleaseTag: "v1.2",
      },
    });
  });

  it.each([
    [
      "the include filter",
      { includeRegex: "^(?!.*-beta)" },
      "regex_error_invalid",
    ],
    [
      "the exclude filter",
      { excludeRegex: "b".repeat(513) },
      "regex_error_invalid",
    ],
    [
      "the version tag pattern",
      { versionTagPattern: "^v(?<version>\\d+)(?!-beta)" },
      "version_tag_pattern_error_invalid",
    ],
  ])(
    "still refuses %s changed into another refused value and keeps the stored repository",
    async (_, change, error) => {
      await storeRepositories([LEGACY]);
      const { updateRepositorySettingsAction } = await import("@/app/actions");

      const result = await updateRepositorySettingsAction(LEGACY.id, {
        ...LEGACY_DRAFT,
        ...change,
      });

      expect({ result, stored: await storedLegacy() }).toEqual({
        result: { success: false, error },
        stored: {
          isPinned: undefined,
          includeRegex: LOOKAHEAD_INCLUDE,
          excludeRegex: LONG_FILTER,
          versionTagPattern: LOOKAHEAD_VERSION,
          lastSeenReleaseTag: "v1.2",
        },
      });
    },
  );
});

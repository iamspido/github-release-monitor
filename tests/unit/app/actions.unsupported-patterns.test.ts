// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

const mem: { repos: Repository[] } = { repos: [] };
const globalSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 5,
  releaseChannels: ["stable"],
  releaseSelectionStrategy: "newest",
  showAcknowledge: true,
};
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));
vi.mock("@/lib/storage/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/settings")>()),
  getSettings: async () => globalSettings,
}));
vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

// The real settings save, repository save and import refuse patterns RE2 cannot
// evaluate, with the message of an invalid regular expression.
const UNSUPPORTED_FILTERS = [
  "^(?!.*-rc)",
  "(?<=v)\\d+",
  "^(\\d)\\1",
  "a".repeat(513),
];

describe("saving settings with patterns the linear-time engine cannot evaluate", () => {
  it.each(UNSUPPORTED_FILTERS)(
    "the settings save refuses the filter %s with the invalid-regex message",
    async (pattern) => {
      const { prepareSettingsUpdate } = await import(
        "@/lib/settings/update-command"
      );
      const { createDefaultSettings } = await import("@/lib/storage/settings");
      const current = createDefaultSettings();

      expect({
        include: prepareSettingsUpdate(
          { includeRegex: pattern },
          current,
          true,
        ),
        exclude: prepareSettingsUpdate(
          { excludeRegex: pattern },
          current,
          true,
        ),
      }).toEqual({
        include: { ok: false, errorKey: "regex_error_invalid", locale: "en" },
        exclude: { ok: false, errorKey: "regex_error_invalid", locale: "en" },
      });
    },
  );

  it("the settings save refuses a custom security line with a lookbehind, a sticky or set flag, or above 512 characters", async () => {
    const { prepareSettingsUpdate } = await import(
      "@/lib/settings/update-command"
    );
    const { createDefaultSettings } = await import("@/lib/storage/settings");
    const current = createDefaultSettings();
    const errorKey = (customSecurityPatterns: string) => {
      const result = prepareSettingsUpdate(
        { customSecurityPatterns },
        current,
        true,
      );
      return result.ok ? null : result.errorKey;
    };

    expect({
      lookbehind: errorKey("breaking\n/(?<=CVE-)\\d+/"),
      sticky: errorKey("/security/y"),
      unicodeSets: errorKey("/[\\p{L}--[a-z]]/v"),
      longLiteral: errorKey(`/${"a".repeat(513)}/`),
      longKeyword: errorKey("k".repeat(513)),
      invalid: errorKey("/[/"),
      valid: errorKey("breaking\n/CVE-\\d{4}-\\d{4,}/i"),
    }).toEqual({
      lookbehind: "security_patterns_error_invalid",
      sticky: "security_patterns_error_invalid",
      unicodeSets: "security_patterns_error_invalid",
      longLiteral: "security_patterns_error_invalid",
      longKeyword: "security_patterns_error_invalid",
      invalid: "security_patterns_error_invalid",
      valid: null,
    });
  });

  it("the settings save still accepts ordinary filters", async () => {
    const { prepareSettingsUpdate } = await import(
      "@/lib/settings/update-command"
    );
    const { createDefaultSettings } = await import("@/lib/storage/settings");
    const result = prepareSettingsUpdate(
      { includeRegex: "^v\\d+\\.\\d+", excludeRegex: "beta|rc|-dev$" },
      createDefaultSettings(),
      true,
    );

    expect(result.ok).toBe(true);
  });
});

describe("saving repository settings with patterns the linear-time engine cannot evaluate", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [
      {
        id: "github:acme/tool",
        url: "https://github.com/acme/tool",
        includeRegex: "^v",
      },
    ];
  });

  it.each(UNSUPPORTED_FILTERS)(
    "the repository save refuses the include filter %s and keeps the stored one",
    async (pattern) => {
      const { updateRepositorySettingsAction } = await import("@/app/actions");
      const result = await updateRepositorySettingsAction("github:acme/tool", {
        includeRegex: pattern,
        excludeRegex: undefined,
        releaseChannels: ["stable"],
        preReleaseSubChannels: undefined,
        releasesPerPage: 30,
        appriseTags: undefined,
        appriseFormat: undefined,
      });

      expect({ result, stored: mem.repos[0].includeRegex }).toEqual({
        result: { success: false, error: "regex_error_invalid" },
        stored: "^v",
      });
    },
  );

  it("the repository save refuses a version tag pattern with a lookahead as an invalid one", async () => {
    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("github:acme/tool", {
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
      releaseChannels: ["stable"],
      releasesPerPage: 30,
    });

    expect({ result, stored: mem.repos[0].versionTagPattern }).toEqual({
      result: { success: false, error: "version_tag_pattern_error_invalid" },
      stored: undefined,
    });
  });
});

describe("importing repositories with patterns the linear-time engine cannot evaluate", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [
      { id: "github:acme/existing", url: "https://github.com/acme/existing" },
    ];
  });

  it.each([
    ["includeRegex", "(?<=v)\\d+"],
    ["excludeRegex", "^(?!v)"],
    ["includeRegex", "x".repeat(513)],
    ["excludeRegex", "(["],
  ] as const)(
    "an import whose %s is %s is refused with the invalid-regex message and stores nothing",
    async (field, pattern) => {
      const { importRepositoriesAction } = await import("@/app/actions");
      const before = JSON.stringify(mem.repos);
      const result = await importRepositoriesAction([
        { id: "acme/ok", url: "https://github.com/acme/ok" },
        {
          id: "acme/tool",
          url: "https://github.com/acme/tool",
          ...(field === "includeRegex"
            ? { includeRegex: pattern }
            : { excludeRegex: pattern }),
        },
      ]);

      expect({
        result,
        unchanged: JSON.stringify(mem.repos) === before,
      }).toEqual({
        result: {
          success: false,
          message: "regex_error_invalid https://github.com/acme/tool",
        },
        unchanged: true,
      });
    },
  );

  it("an import still takes over ordinary filters", async () => {
    const { importRepositoriesAction } = await import("@/app/actions");
    const result = await importRepositoriesAction([
      {
        id: "acme/tool",
        url: "https://github.com/acme/tool",
        includeRegex: "^v\\d+",
        excludeRegex: "-dev$",
      },
    ]);

    expect({
      success: result.success,
      stored: mem.repos.find((repo) => repo.id === "github:acme/tool"),
    }).toEqual({
      success: true,
      stored: expect.objectContaining({
        includeRegex: "^v\\d+",
        excludeRegex: "-dev$",
      }),
    });
  });

  it("the import parser drops a version tag pattern with a lookahead, as an invalid one", async () => {
    const { parseImportedRepository } = await import(
      "@/lib/repositories/repository-import"
    );

    expect(
      parseImportedRepository({
        url: "https://github.com/acme/tool",
        versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
      }),
    ).not.toHaveProperty("versionTagPattern");
  });
});

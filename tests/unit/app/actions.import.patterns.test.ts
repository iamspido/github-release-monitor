// vitest globals enabled

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Repository } from "@/types";

// The real import action reads patterns as the save does: one the save would
// refuse refuses the whole import, and filters are stored trimmed.

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));
vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

let dataDir: string;
let cwdSpy: { mockRestore: () => void };

beforeEach(async () => {
  vi.resetModules();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "grm-import-patterns-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dataDir);
  const { saveRepositories } = await import("@/lib/storage/repositories");
  await saveRepositories([
    {
      id: "github:acme/existing",
      url: "https://github.com/acme/existing",
      includeRegex: "^v",
      versionTagPattern: "^v(?<version>\\d+\\.\\d+)$",
    },
  ]);
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function storedRepositories(): Promise<Repository[]> {
  const { getRepositories } = await import("@/lib/storage/repositories");
  return getRepositories();
}

async function stored(id: string) {
  const repository = (await storedRepositories()).find(
    (entry) => entry.id === id,
  );
  return {
    includeRegex: repository?.includeRegex,
    excludeRegex: repository?.excludeRegex,
    versionTagPattern: repository?.versionTagPattern,
  };
}

describe("importing a version tag pattern the save would refuse", () => {
  it.each([
    [
      "a lookahead",
      "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
      "version_tag_pattern_error_invalid",
    ],
    [
      "a backreference",
      "^(v)(?<version>\\d+)\\1",
      "version_tag_pattern_error_invalid",
    ],
    [
      "invalid syntax",
      "^v(?<version>\\d+",
      "version_tag_pattern_error_invalid",
    ],
    [
      "no version group",
      "^v\\d+\\.\\d+",
      "version_tag_pattern_error_missing_version_group",
    ],
  ])(
    "an import whose version tag pattern has %s is refused with the save's message and stores nothing",
    async (_, versionTagPattern, error) => {
      const before = await storedRepositories();
      const { importRepositoriesAction } = await import("@/app/actions");

      const result = await importRepositoriesAction([
        { id: "acme/ok", url: "https://github.com/acme/ok" },
        {
          id: "acme/tool",
          url: "https://github.com/acme/tool",
          releaseSelectionStrategy: "highest_version",
          versionTagPattern,
        },
      ]);

      expect({ result, after: await storedRepositories() }).toEqual({
        result: {
          success: false,
          message: `${error} https://github.com/acme/tool`,
        },
        after: before,
      });
    },
  );

  it("an import whose existing repository brings a refused version tag pattern keeps the stored one", async () => {
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction([
      {
        id: "acme/existing",
        url: "https://github.com/acme/existing",
        versionTagPattern: "^v(?<version>\\d+)(?=-final)",
      },
    ]);

    expect({
      success: result.success,
      stored: await stored("github:acme/existing"),
    }).toEqual({
      success: false,
      stored: {
        includeRegex: "^v",
        excludeRegex: undefined,
        versionTagPattern: "^v(?<version>\\d+\\.\\d+)$",
      },
    });
  });

  it("an import still takes over a usable version tag pattern, trimmed", async () => {
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction([
      {
        id: "acme/tool",
        url: "https://github.com/acme/tool",
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "  ^release-(?<version>\\d+\\.\\d+\\.\\d+)$ ",
      },
    ]);

    expect({
      success: result.success,
      stored: await stored("github:acme/tool"),
    }).toEqual({
      success: true,
      stored: {
        includeRegex: undefined,
        excludeRegex: undefined,
        versionTagPattern: "^release-(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    });
  });
});

describe("importing include and exclude filters as the save stores them", () => {
  it("an imported filter of spaces is stored as no filter, also over a stored one", async () => {
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction([
      {
        id: "acme/tool",
        url: "https://github.com/acme/tool",
        includeRegex: "   ",
        excludeRegex: "\t ",
      },
      {
        id: "acme/existing",
        url: "https://github.com/acme/existing",
        includeRegex: "  ",
      },
    ]);

    expect({
      success: result.success,
      tool: await stored("github:acme/tool"),
      existing: await stored("github:acme/existing"),
    }).toEqual({
      success: true,
      tool: {
        includeRegex: undefined,
        excludeRegex: undefined,
        versionTagPattern: undefined,
      },
      existing: {
        includeRegex: undefined,
        excludeRegex: undefined,
        versionTagPattern: "^v(?<version>\\d+\\.\\d+)$",
      },
    });
  });

  it("an imported filter with surrounding spaces is checked and stored trimmed, so 512 characters and a space pass", async () => {
    const longFilter = `[${"a".repeat(510)}]`;
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction([
      {
        id: "acme/tool",
        url: "https://github.com/acme/tool",
        includeRegex: `${longFilter} `,
        excludeRegex: "  -dev$ ",
      },
    ]);

    expect({
      success: result.success,
      stored: await stored("github:acme/tool"),
    }).toEqual({
      success: true,
      stored: {
        includeRegex: longFilter,
        excludeRegex: "-dev$",
        versionTagPattern: undefined,
      },
    });
  });

  it("an imported filter that is still too long once trimmed is refused", async () => {
    const before = await storedRepositories();
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction([
      {
        id: "acme/tool",
        url: "https://github.com/acme/tool",
        excludeRegex: ` ${"a".repeat(513)} `,
      },
    ]);

    expect({ result, after: await storedRepositories() }).toEqual({
      result: {
        success: false,
        message: "regex_error_invalid https://github.com/acme/tool",
      },
      after: before,
    });
  });
});

describe("re-importing patterns stored before the linear-time engine", () => {
  const legacy: Repository = {
    id: "github:acme/legacy",
    url: "https://github.com/acme/legacy",
    displayName: "Legacy",
    isNew: false,
    releaseSelectionStrategy: "highest_version",
    includeRegex: "^v(?!.*-rc)",
    excludeRegex: "(?<=-)dev",
    versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
    lastSeenReleaseTag: "v1.2.3",
    etag: 'W/"legacy"',
  };
  const PATTERNS = {
    includeRegex: legacy.includeRegex,
    excludeRegex: legacy.excludeRegex,
    versionTagPattern: legacy.versionTagPattern,
  };

  beforeEach(async () => {
    const { saveRepositories } = await import("@/lib/storage/repositories");
    await saveRepositories([...(await storedRepositories()), legacy]);
  });

  async function storedLegacy() {
    const repository = (await storedRepositories()).find(
      (entry) => entry.id === legacy.id,
    );
    return {
      displayName: repository?.displayName,
      includeRegex: repository?.includeRegex,
      excludeRegex: repository?.excludeRegex,
      versionTagPattern: repository?.versionTagPattern,
      lastSeenReleaseTag: repository?.lastSeenReleaseTag,
      etag: repository?.etag,
    };
  }

  it("re-importing the export of a repository with such patterns succeeds and keeps them stored as they are", async () => {
    const { getRepositoriesForExport } = await import(
      "@/lib/repositories/repository-mutation-actions"
    );
    const exported = await getRepositoriesForExport();
    const { importRepositoriesAction } = await import("@/app/actions");

    const result = await importRepositoriesAction(exported.data ?? []);

    expect({
      exported: exported.success,
      success: result.success,
      stored: await storedLegacy(),
    }).toEqual({
      exported: true,
      success: true,
      stored: {
        displayName: "Legacy",
        ...PATTERNS,
        lastSeenReleaseTag: "v1.2.3",
        etag: 'W/"legacy"',
      },
    });
  });

  it.each(Object.keys(PATTERNS) as (keyof typeof PATTERNS)[])(
    "an import that brings the stored %s unchanged, with surrounding spaces, takes over its other changes and keeps the pattern stored as it is",
    async (field) => {
      const { importRepositoriesAction } = await import("@/app/actions");

      const result = await importRepositoriesAction([
        {
          id: "acme/legacy",
          url: "https://github.com/acme/legacy",
          displayName: "Legacy tool",
          [field]: `  ${PATTERNS[field]} `,
        },
      ]);

      expect({
        success: result.success,
        stored: await storedLegacy(),
      }).toEqual({
        success: true,
        stored: {
          displayName: "Legacy tool",
          ...PATTERNS,
          lastSeenReleaseTag: "v1.2.3",
          etag: 'W/"legacy"',
        },
      });
    },
  );

  it.each([
    ["includeRegex", "^v(?!.*-beta)", "regex_error_invalid"],
    ["excludeRegex", "(?<=_)dev", "regex_error_invalid"],
    [
      "versionTagPattern",
      "^v(?<version>\\d+\\.\\d+)(?!-rc)",
      "version_tag_pattern_error_invalid",
    ],
  ] as const)(
    "an import that changes the stored %s to another refused pattern is still refused and stores nothing",
    async (field, pattern, error) => {
      const before = await storedRepositories();
      const { importRepositoriesAction } = await import("@/app/actions");

      const result = await importRepositoriesAction([
        {
          id: "acme/legacy",
          url: "https://github.com/acme/legacy",
          [field]: pattern,
        },
      ]);

      expect({ result, after: await storedRepositories() }).toEqual({
        result: {
          success: false,
          message: `${error} https://github.com/acme/legacy`,
        },
        after: before,
      });
    },
  );

  it.each(Object.keys(PATTERNS) as (keyof typeof PATTERNS)[])(
    "an import of a new repository with the %s another repository has stored is still refused and stores nothing",
    async (field) => {
      const before = await storedRepositories();
      const { importRepositoriesAction } = await import("@/app/actions");

      const result = await importRepositoriesAction([
        {
          id: "acme/tool",
          url: "https://github.com/acme/tool",
          releaseSelectionStrategy: "highest_version",
          [field]: PATTERNS[field],
        },
      ]);

      expect({ result, after: await storedRepositories() }).toEqual({
        result: {
          success: false,
          message: `${
            field === "versionTagPattern"
              ? "version_tag_pattern_error_invalid"
              : "regex_error_invalid"
          } https://github.com/acme/tool`,
        },
        after: before,
      });
    },
  );
});

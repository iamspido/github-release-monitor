// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

const intlMocks = vi.hoisted(() => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: intlMocks.getTranslations,
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
};
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));
vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => globalSettings,
}));

describe("updateRepositorySettingsAction", () => {
  beforeEach(() => {
    vi.resetModules();
    intlMocks.getTranslations.mockClear();
    mem.repos = [];
  });

  it("updates settings and clears ETag when filters/pagination change", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"123"',
        includeRegex: "old",
        excludeRegex: "x",
        releaseChannels: ["stable"],
        preReleaseSubChannels: ["beta"],
        releasesPerPage: 30,
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const res = await updateRepositorySettingsAction("o/r", {
      includeRegex: " new ", // whitespace should be trimmed
      excludeRegex: "", // becomes undefined
      releaseChannels: ["prerelease"],
      preReleaseSubChannels: ["rc"],
      releasesPerPage: 50,
      appriseTags: "tag",
      appriseFormat: "html",
    });

    expect(res.success).toBe(true);
    const r = mem.repos[0];
    expect(r.includeRegex).toBe("new");
    expect(r.excludeRegex).toBeUndefined();
    expect(r.releaseChannels).toEqual(["prerelease"]);
    expect(r.preReleaseSubChannels).toEqual(["rc"]);
    expect(r.releasesPerPage).toBe(50);
    expect(r.appriseTags).toBe("tag");
    expect(r.appriseFormat).toBe("html");
    // etag cleared because of changes
    expect(r.etag).toBeUndefined();
  });

  it("keeps ETag when no relevant changes", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"keep"',
        includeRegex: undefined,
        excludeRegex: undefined,
        releaseChannels: ["stable"],
        preReleaseSubChannels: undefined,
        releasesPerPage: 30,
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const res = await updateRepositorySettingsAction("o/r", {
      includeRegex: undefined,
      excludeRegex: undefined,
      releaseChannels: ["stable"],
      preReleaseSubChannels: undefined,
      releasesPerPage: 30,
      appriseTags: undefined,
      appriseFormat: undefined,
    });
    expect(res.success).toBe(true);
    expect(mem.repos[0].etag).toBe('W/"keep"');
  });

  it("rebaselines release detection when the effective selection changes", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"old"',
        lastSeenReleaseTag: "v1.0.0",
        isNew: true,
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      releaseSelectionStrategy: "highest_version",
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].releaseSelectionStrategy).toBe("highest_version");
    expect(mem.repos[0].lastSeenReleaseTag).toBeUndefined();
    expect(mem.repos[0].isNew).toBe(false);
    expect(mem.repos[0].etag).toBeUndefined();
  });

  it("rebaselines release detection when the version tag pattern changes", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        releaseSelectionStrategy: "highest_version",
        etag: 'W/"old"',
        lastSeenReleaseTag: "v1.0.0",
        isNew: true,
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].versionTagPattern).toContain("(?<version>");
    expect(mem.repos[0].lastSeenReleaseTag).toBeUndefined();
    expect(mem.repos[0].isNew).toBe(false);
    expect(mem.repos[0].etag).toBeUndefined();
  });

  it("rejects a version tag pattern without a named version group", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        releaseSelectionStrategy: "highest_version",
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^(\\d+\\.\\d+\\.\\d+)$",
    });

    expect(result).toEqual({
      success: false,
      error: "version_tag_pattern_error_missing_version_group",
    });
    expect(mem.repos[0].versionTagPattern).toBeUndefined();
  });

  it("rejects invalid custom pre-release markers", async () => {
    mem.repos = [{ id: "o/r", url: "https://github.com/o/r" }];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      customPreReleaseMarkers: ["."],
    });

    expect(result).toEqual({
      success: false,
      error: "custom_prerelease_markers_error_invalid .",
    });
    expect(intlMocks.getTranslations).toHaveBeenCalledWith({
      locale: "en",
      namespace: "SettingsForm",
    });
    expect(mem.repos[0].customPreReleaseMarkers).toBeUndefined();
  });

  it("normalizes the display name without clearing the ETag", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"keep"',
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      displayName: "  Production Monitor  ",
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].displayName).toBe("Production Monitor");
    expect(mem.repos[0].etag).toBe('W/"keep"');
  });

  it("preserves the display name for partial updates that omit it", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        displayName: "Production Monitor",
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      tags: ["infra"],
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].displayName).toBe("Production Monitor");
  });

  it("pins and unpins without invalidating release data", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"keep"',
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const pinResult = await updateRepositorySettingsAction("o/r", {
      isPinned: true,
    });

    expect(pinResult.success).toBe(true);
    expect(mem.repos[0].isPinned).toBe(true);
    expect(mem.repos[0].etag).toBe('W/"keep"');

    const partialResult = await updateRepositorySettingsAction("o/r", {
      tags: ["infra"],
    });
    expect(partialResult.success).toBe(true);
    expect(mem.repos[0].isPinned).toBe(true);

    const unpinResult = await updateRepositorySettingsAction("o/r", {
      isPinned: false,
    });
    expect(unpinResult.success).toBe(true);
    expect(mem.repos[0].isPinned).toBeUndefined();
    expect(mem.repos[0].etag).toBe('W/"keep"');
  });

  it("clears an explicitly empty display name", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        displayName: "Production Monitor",
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      displayName: "",
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].displayName).toBeUndefined();
  });

  it("rejects invalid display names before persisting", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        displayName: "Existing",
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      displayName: "x".repeat(101),
    });

    expect(result).toEqual({
      success: false,
      error: "display_name_error_invalid",
    });
    expect(mem.repos[0].displayName).toBe("Existing");
  });

  it("normalizes repository tags without clearing the ETag", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        etag: 'W/"keep"',
        tags: ["old"],
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      tags: [" Infra ", "INFRA", "Media"],
    });

    expect(result.success).toBe(true);
    expect(mem.repos[0].tags).toEqual(["infra", "media"]);
    expect(mem.repos[0].etag).toBe('W/"keep"');
  });

  it("rejects invalid release regexes before persisting repository settings", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        includeRegex: "valid",
      },
    ];

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const result = await updateRepositorySettingsAction("o/r", {
      includeRegex: "([",
      excludeRegex: undefined,
      releaseChannels: ["stable"],
      preReleaseSubChannels: undefined,
      releasesPerPage: 30,
      appriseTags: undefined,
      appriseFormat: undefined,
    });

    expect(result).toEqual({ success: false, error: "regex_error_invalid" });
    expect(mem.repos[0].includeRegex).toBe("valid");
  });
});

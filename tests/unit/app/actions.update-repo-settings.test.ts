// vitest globals enabled

import type { Repository } from "@/types";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

const mem: { repos: Repository[] } = { repos: [] };
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

describe("updateRepositorySettingsAction", () => {
  beforeEach(() => {
    vi.resetModules();
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

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

describe("updateRepositorySettingsAction edge cases", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it("rejects invalid repo id format", async () => {
    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const res = await updateRepositorySettingsAction("Invalid ID", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid repository ID format.");
  });

  it("returns not found error when repo does not exist", async () => {
    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const res = await updateRepositorySettingsAction("o/r", {
      releaseChannels: ["stable"],
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("toast_error_not_found");
  });

  it("saves per-repository automation settings", async () => {
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        lastBackgroundCheckAt: "old",
      },
    ];
    const { updateRepositorySettingsAction } = await import("@/app/actions");

    const res = await updateRepositorySettingsAction("o/r", {
      releaseChannels: ["stable"],
      preReleaseSubChannels: [],
      releasesPerPage: null,
      refreshInterval: 30,
      cacheInterval: 0,
      backgroundCheckCron: null,
    });

    expect(res.success).toBe(true);
    expect(mem.repos[0].refreshInterval).toBe(30);
    expect(mem.repos[0].cacheInterval).toBe(0);
    expect(mem.repos[0].backgroundCheckCron).toBeUndefined();
    expect(mem.repos[0].lastBackgroundCheckAt).toBe("old");
  });

  it("rejects invalid cron settings", async () => {
    mem.repos = [{ id: "o/r", url: "https://github.com/o/r" }];
    const { updateRepositorySettingsAction } = await import("@/app/actions");

    const res = await updateRepositorySettingsAction("o/r", {
      releaseChannels: ["stable"],
      preReleaseSubChannels: [],
      releasesPerPage: null,
      backgroundCheckCron: "0 0 21 * * *",
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("cron_error_invalid");
  });
});

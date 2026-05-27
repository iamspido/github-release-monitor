import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForNewReleases } from "@/lib/releases/checker";
import type { AppSettings, Repository } from "@/types";

const mem: { repos: Repository[]; settings: AppSettings } = {
  repos: [],
  settings: {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 5,
    releasesPerPage: 30,
    parallelRepoFetches: 5,
    releaseChannels: ["stable"],
    preReleaseSubChannels: ["beta"],
    includeRegex: undefined as string | undefined,
    excludeRegex: undefined as string | undefined,
    showAcknowledge: true,
  },
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/releases/checker", () => ({
  checkForNewReleases: vi.fn().mockResolvedValue({ notificationsSent: 0 }),
}));
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));
vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => mem.settings,
  saveSettings: async (s: AppSettings) => {
    mem.settings = JSON.parse(JSON.stringify(s));
  },
}));

describe("updateSettingsAction clears ETags for all change flags", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [
      { id: "a/b", url: "https://github.com/a/b", etag: "E1" },
      { id: "c/d", url: "https://github.com/c/d", etag: "E2" },
    ];
    mem.settings = {
      timeFormat: "24h",
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 5,
      releaseChannels: ["stable"],
      preReleaseSubChannels: ["beta"],
      includeRegex: undefined,
      excludeRegex: undefined,
      showAcknowledge: true,
    };
  });

  async function runAndAssert(newSettings: AppSettings) {
    const { updateSettingsAction } = await import("@/app/settings/actions");
    await updateSettingsAction(newSettings);
    expect(mem.repos[0].etag).toBeUndefined();
    expect(mem.repos[1].etag).toBeUndefined();
  }

  it("regexChanged clears ETags", async () => {
    await runAndAssert({ ...mem.settings, includeRegex: "^v" });
  });

  it("channelsChanged clears ETags", async () => {
    await runAndAssert({
      ...mem.settings,
      releaseChannels: ["stable", "prerelease"],
    });
  });

  it("preSubsChanged clears ETags", async () => {
    await runAndAssert({
      ...mem.settings,
      preReleaseSubChannels: ["beta", "rc"],
    });
  });

  it("rppChanged clears ETags", async () => {
    await runAndAssert({ ...mem.settings, releasesPerPage: 99 });
  });

  it("display sort changes do not clear ETags or trigger refresh", async () => {
    vi.mocked(checkForNewReleases).mockClear();
    const { updateSettingsAction } = await import("@/app/settings/actions");
    await updateSettingsAction({
      ...mem.settings,
      releaseSortOrder: "provider_grouped",
      providerSortOrder: ["codeberg", "gitlab", "github"],
      prioritizeNewSecurityReleases: true,
    });

    expect(mem.repos[0].etag).toBe("E1");
    expect(mem.repos[1].etag).toBe("E2");
    expect(checkForNewReleases).not.toHaveBeenCalled();
  });
});

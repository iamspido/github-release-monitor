// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

const checkForNewReleasesMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
  getLocale: async () => "en",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn() }),
}));

vi.mock("@/lib/releases/checker", () => ({
  checkForNewReleases: checkForNewReleasesMock,
}));

const memRepos: { list: Repository[] } = { list: [] };
const settingsStore: { current: AppSettings } = {
  current: {
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
  },
};

vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => memRepos.list,
  saveRepositories: async (list: Repository[]) => {
    memRepos.list = JSON.parse(JSON.stringify(list));
  },
}));

vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => settingsStore.current,
  normalizeSettings: (settings: AppSettings) => settings,
  saveSettings: async (s: AppSettings) => {
    settingsStore.current = JSON.parse(JSON.stringify(s));
  },
}));

describe("settings actions", () => {
  beforeEach(() => {
    vi.resetModules();
    checkForNewReleasesMock
      .mockReset()
      .mockResolvedValue({ notificationsSent: 0 });
    memRepos.list = [];
    settingsStore.current = {
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

  it("updateSettingsAction clears ETags on regex change and resets isNew when disabling acknowledge", async () => {
    memRepos.list = [
      { id: "o/a", url: "https://github.com/o/a", etag: "E1", isNew: true },
      { id: "o/b", url: "https://github.com/o/b", etag: "E2", isNew: true },
    ];

    const { updateSettingsAction } = await import("@/app/settings/actions");
    await updateSettingsAction({
      ...settingsStore.current,
      includeRegex: "v.*",
      showAcknowledge: false,
    });

    // ETags cleared
    expect(memRepos.list[0].etag).toBeUndefined();
    expect(memRepos.list[1].etag).toBeUndefined();
    // isNew flags reset due to disabling acknowledge
    expect(memRepos.list[0].isNew).toBe(false);
    expect(memRepos.list[1].isNew).toBe(false);
  });

  it("merges settings patches into the latest persisted state", async () => {
    const { updateSettingsPatchAction } = await import(
      "@/app/settings/actions"
    );

    const first = updateSettingsPatchAction({ releaseSortOrder: "repo_az" });
    const second = updateSettingsPatchAction({
      repositoryFormExpanded: false,
    });
    await Promise.all([first, second]);

    expect(settingsStore.current.releaseSortOrder).toBe("repo_az");
    expect(settingsStore.current.repositoryFormExpanded).toBe(false);
    expect(settingsStore.current.refreshInterval).toBe(10);
  });

  it("rebaselines only repositories inheriting a changed release selection", async () => {
    memRepos.list = [
      {
        id: "o/inherited",
        url: "https://github.com/o/inherited",
        etag: "E1",
        lastSeenReleaseTag: "v1.0.0",
        isNew: true,
      },
      {
        id: "o/override",
        url: "https://github.com/o/override",
        etag: "E2",
        lastSeenReleaseTag: "v2.0.0",
        isNew: true,
        releaseSelectionStrategy: "newest",
      },
    ];
    const { updateSettingsAction } = await import("@/app/settings/actions");

    await updateSettingsAction({
      ...settingsStore.current,
      releaseSelectionStrategy: "highest_version",
    });

    expect(memRepos.list[0]).toMatchObject({ isNew: false });
    expect(memRepos.list[0].lastSeenReleaseTag).toBeUndefined();
    expect(memRepos.list[0].etag).toBeUndefined();
    expect(memRepos.list[1].lastSeenReleaseTag).toBe("v2.0.0");
    expect(memRepos.list[1].isNew).toBe(true);
    expect(memRepos.list[1].etag).toBe("E2");
  });

  it("rejects invalid release regexes before persisting settings", async () => {
    const { updateSettingsAction } = await import("@/app/settings/actions");
    const previousSettings = structuredClone(settingsStore.current);

    const result = await updateSettingsAction({
      ...settingsStore.current,
      includeRegex: "([",
    });

    expect(result).toEqual({
      success: false,
      message: {
        title: "toast_error_title",
        description: "regex_error_invalid",
      },
    });
    expect(settingsStore.current).toEqual(previousSettings);
  });

  it("returns invalid custom pre-release marker values", async () => {
    const { updateSettingsAction } = await import("@/app/settings/actions");
    const previousSettings = structuredClone(settingsStore.current);

    const result = await updateSettingsAction({
      ...settingsStore.current,
      customPreReleaseMarkers: [".", "Edge3"],
    });

    expect(result).toEqual({
      success: false,
      message: {
        title: "toast_error_title",
        description: "custom_prerelease_markers_error_invalid ., Edge3",
      },
    });
    expect(settingsStore.current).toEqual(previousSettings);
  });

  it("does not mutate repositories when settings validation fails", async () => {
    memRepos.list = [
      {
        id: "o/a",
        url: "https://github.com/o/a",
        etag: "E1",
        isNew: true,
      },
    ];
    const previousRepositories = structuredClone(memRepos.list);
    const { updateSettingsAction } = await import("@/app/settings/actions");

    const result = await updateSettingsAction({
      ...settingsStore.current,
      includeRegex: "([",
      showAcknowledge: false,
    });

    expect(result.success).toBe(false);
    expect(memRepos.list).toEqual(previousRepositories);
  });

  it("deleteAllRepositoriesAction clears storage and returns success", async () => {
    memRepos.list = [{ id: "x/y", url: "https://github.com/x/y" }];
    const { deleteAllRepositoriesAction } = await import(
      "@/app/settings/actions"
    );
    const res = await deleteAllRepositoriesAction();
    expect(res.success).toBe(true);
    expect(Array.isArray(memRepos.list)).toBe(true);
    expect(memRepos.list.length).toBe(0);
  });

  it("saves a valid global background cron schedule", async () => {
    const { updateSettingsAction } = await import("@/app/settings/actions");
    const res = await updateSettingsAction({
      ...settingsStore.current,
      backgroundCheckCron: "0 21 * * *",
    });

    expect(res.success).toBe(true);
    expect(settingsStore.current.backgroundCheckCron).toBe("0 21 * * *");
  });

  it("rejects invalid global background cron schedules", async () => {
    const { updateSettingsAction } = await import("@/app/settings/actions");
    const res = await updateSettingsAction({
      ...settingsStore.current,
      backgroundCheckCron: "0 0 21 * * *",
    });

    expect(res.success).toBe(false);
    expect(settingsStore.current.backgroundCheckCron).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StatResult = {
  mtimeMs: number;
};

const fsMock = {
  mkdir: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
};

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("fs", () => ({
  promises: fsMock,
}));

vi.mock("@/lib/logger", () => {
  const logger = {
    ...loggerMock,
    withScope: () => logger,
  };
  return { logger };
});

describe("storage/settings failure scenarios", () => {
  beforeEach(() => {
    vi.resetModules();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue("{}");
    fsMock.stat.mockResolvedValue({ mtimeMs: 1 } satisfies StatResult);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("throws when ensureDataFileExists cannot write settings file", async () => {
    fsMock.access.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    const failure = new Error("disk full");
    fsMock.writeFile.mockRejectedValueOnce(failure);
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).rejects.toThrow(failure);
  });

  it("throws when saveSettings cannot persist data", async () => {
    const { saveSettings, getSettings, __clearSettingsCacheForTests__ } =
      await import("@/lib/storage/settings");

    // warm cache so saveSettings runs writeFile branch
    const current = await getSettings();
    await __clearSettingsCacheForTests__();

    const failure = new Error("disk full");
    fsMock.writeFile.mockRejectedValueOnce(failure);

    await expect(saveSettings(current)).rejects.toThrow(
      "Could not save settings data.",
    );
  });

  it("defaults security release prioritization to disabled for old settings files", async () => {
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.prioritizeNewSecurityReleases).toBe(false);
  });

  it("creates independent complete default settings", async () => {
    const { createDefaultSettings } = await import("@/lib/storage/settings");
    const first = createDefaultSettings({ GITHUB_ACCESS_TOKEN: "token" });
    const second = createDefaultSettings({});

    expect(first.parallelRepoFetches).toBe(5);
    expect(second.parallelRepoFetches).toBe(1);
    expect(first).toHaveProperty("repositoryFormExpanded", true);
    expect(first).toHaveProperty("emailIncludeReleaseNotes", true);
    expect(first).toHaveProperty("emailNotificationMode", "per_release");
    expect(first).toHaveProperty("appriseIncludeReleaseNotes", true);
    expect(first).toHaveProperty("appriseNotificationMode", "per_release");
    expect(first).toHaveProperty("notificationMaxMessagesPerRun", 20);
    expect(first).toHaveProperty("notificationDeliveryConcurrency", 4);
    expect(first).toHaveProperty("appriseMaxCharacters", 1800);
    expect(first).toHaveProperty("releaseSelectionStrategy", "newest");

    first.releaseChannels.push("draft");
    if (!first.providerSortOrder) {
      throw new Error("Expected complete default provider sort order.");
    }
    first.providerSortOrder.reverse();
    expect(second.releaseChannels).toEqual(["stable"]);
    expect(second.providerSortOrder).toEqual(["github", "gitlab", "codeberg"]);
  });

  it("defaults security release settings for old settings files", async () => {
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.securityHighlightColorPreset).toBe("yellow");
    expect(settings.securityHighlightCustomColor).toBe("#eab308");
    expect(settings.confirmSecurityAcknowledge).toBe(false);
    expect(settings.includeDefaultSecurityPatterns).toBe(true);
    expect(settings.customSecurityPatterns).toBeUndefined();
  });

  it("defaults the repository form to expanded for old settings files", async () => {
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.repositoryFormExpanded).toBe(true);
  });

  it("migrates explicitly selected legacy short channels to custom markers", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        preReleaseSubChannels: ["a", "alpha", "b", "m", "milestone"],
        customPreReleaseMarkers: [" Testing ", "testing", "EDGE"],
      }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.preReleaseSubChannels).toEqual(["alpha", "milestone"]);
    expect(settings.customPreReleaseMarkers).toEqual([
      "testing",
      "edge",
      "a",
      "b",
      "m",
    ]);
  });

  it("preserves a legacy short-channel-only configuration", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({ preReleaseSubChannels: ["b"] }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.preReleaseSubChannels).toEqual([]);
    expect(settings.customPreReleaseMarkers).toEqual(["b"]);
  });

  it("does not opt old defaults back into removed short markers", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        preReleaseSubChannels: [
          "a",
          "alpha",
          "b",
          "beta",
          "canary",
          "cr",
          "dev",
          "eap",
          "m",
          "milestone",
          "next",
          "nightly",
          "pre",
          "preview",
          "pr",
          "rc",
          "snapshot",
          "sp",
          "tp",
        ],
      }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.preReleaseSubChannels).not.toContain("a");
    expect(settings.preReleaseSubChannels).not.toContain("b");
    expect(settings.preReleaseSubChannels).not.toContain("m");
    expect(settings.customPreReleaseMarkers).toEqual([]);
  });

  it("rejects invalid persisted custom pre-release markers", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({ customPreReleaseMarkers: ["."] }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).rejects.toThrow(
      "customPreReleaseMarkers contains invalid markers",
    );
  });

  it("normalizes persisted Unicode markers without invalidating them", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({ customPreReleaseMarkers: ["İtest"] }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).resolves.toMatchObject({
      customPreReleaseMarkers: ["i\u0307test"],
    });
  });

  it("returns cloned settings so callers cannot mutate the cache", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        releaseChannels: ["stable"],
        preReleaseSubChannels: ["rc"],
        customPreReleaseMarkers: ["testing"],
      }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    const first = await getSettings();
    first.releaseChannels.push("draft");
    first.preReleaseSubChannels?.push("beta");
    first.customPreReleaseMarkers?.push("edge");

    const second = await getSettings();

    expect(second.releaseChannels).toEqual(["stable"]);
    expect(second.preReleaseSubChannels).toEqual(["rc"]);
    expect(second.customPreReleaseMarkers).toEqual(["testing"]);
  });

  it("uses the cached settings within 500ms and refreshes after mtime changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    fsMock.readFile.mockResolvedValue(JSON.stringify({ locale: "en" }));
    fsMock.stat.mockResolvedValue({ mtimeMs: 1 } satisfies StatResult);
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).resolves.toMatchObject({ locale: "en" });

    fsMock.stat.mockClear();
    fsMock.readFile.mockClear();

    await getSettings();
    vi.advanceTimersByTime(499);
    await getSettings();

    expect(fsMock.stat).not.toHaveBeenCalled();
    expect(fsMock.readFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    fsMock.stat.mockResolvedValueOnce({ mtimeMs: 1 } satisfies StatResult);
    await getSettings();

    expect(fsMock.stat).toHaveBeenCalledTimes(1);
    expect(fsMock.readFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    fsMock.stat.mockResolvedValueOnce({ mtimeMs: 2 } satisfies StatResult);
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "de" }));

    await expect(getSettings()).resolves.toMatchObject({ locale: "de" });
    expect(fsMock.readFile).toHaveBeenCalledTimes(1);
  });

  it("fails closed and logs when settings JSON is invalid", async () => {
    fsMock.readFile.mockResolvedValue("{");
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).rejects.toBeInstanceOf(SyntaxError);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Error reading or parsing settings.json:",
      expect.any(SyntaxError),
    );
  });

  it("rejects structurally invalid settings JSON", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({ refreshInterval: "ten" }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).rejects.toThrow(
      "refreshInterval must be an integer between 1 and 5256000",
    );
  });

  it.each([
    [{ releasesPerPage: 0 }, "releasesPerPage"],
    [{ releasesPerPage: 1001 }, "releasesPerPage"],
    [{ parallelRepoFetches: 51 }, "parallelRepoFetches"],
    [{ appriseMaxCharacters: -1 }, "appriseMaxCharacters"],
    [{ notificationMaxMessagesPerRun: -1 }, "notificationMaxMessagesPerRun"],
    [
      { notificationMaxMessagesPerRun: 10_001 },
      "notificationMaxMessagesPerRun",
    ],
    [{ notificationDeliveryConcurrency: 0 }, "notificationDeliveryConcurrency"],
    [
      { notificationDeliveryConcurrency: 51 },
      "notificationDeliveryConcurrency",
    ],
    [{ emailNotificationMode: "single" }, "emailNotificationMode"],
    [{ appriseNotificationMode: "digest" }, "appriseNotificationMode"],
    [{ emailIncludeReleaseNotes: "yes" }, "emailIncludeReleaseNotes"],
    [{ appriseIncludeReleaseNotes: 1 }, "appriseIncludeReleaseNotes"],
  ])(
    "rejects semantically invalid persisted settings %j",
    async (value, key) => {
      fsMock.readFile.mockResolvedValue(JSON.stringify(value));
      const { getSettings } = await import("@/lib/storage/settings");

      await expect(getSettings()).rejects.toThrow(String(key));
    },
  );

  it("rejects semantically invalid settings before writing", async () => {
    const { getSettings, saveSettings } = await import(
      "@/lib/storage/settings"
    );
    const current = await getSettings();
    fsMock.writeFile.mockClear();

    await expect(
      saveSettings({ ...current, releasesPerPage: -1 }),
    ).rejects.toThrow("Could not save settings data.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("returns the configured locale only when it is supported", async () => {
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "ar" }));
    const firstModule = await import("@/lib/storage/settings");

    await expect(firstModule.getLocaleSetting()).resolves.toBe("ar");

    vi.resetModules();
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ locale: "invalid_locale" }),
    );
    const secondModule = await import("@/lib/storage/settings");

    await expect(secondModule.getLocaleSetting()).resolves.toBe("en");
  });

  it("refreshes the locale immediately when another route bundle updates the settings file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "en" }));
    fsMock.stat.mockResolvedValue({ mtimeMs: 1 } satisfies StatResult);
    const { getLocaleSetting } = await import("@/lib/storage/settings");

    await expect(getLocaleSetting()).resolves.toBe("en");

    fsMock.stat.mockClear();
    fsMock.readFile.mockClear();
    fsMock.stat.mockResolvedValueOnce({ mtimeMs: 2 } satisfies StatResult);
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "de" }));

    await expect(getLocaleSetting()).resolves.toBe("de");
    expect(fsMock.stat).toHaveBeenCalledTimes(1);
    expect(fsMock.readFile).toHaveBeenCalledTimes(1);
  });

  it("normalizes sort settings when saving and updates the in-memory cache", async () => {
    const { getSettings, saveSettings } = await import(
      "@/lib/storage/settings"
    );

    const current = await getSettings();

    await saveSettings({
      ...current,
      releaseSortOrder: "not-real",
      releaseSelectionStrategy: "not-real",
      providerSortOrder: ["gitlab", "bad", "github"],
    } as unknown as typeof current);

    await expect(getSettings()).resolves.toMatchObject({
      releaseSortOrder: "latest_first",
      releaseSelectionStrategy: "newest",
      providerSortOrder: ["gitlab", "github", "codeberg"],
    });
  });
});

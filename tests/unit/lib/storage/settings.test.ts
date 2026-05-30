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
    fsMock.access.mockRejectedValueOnce(new Error("missing"));
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

  it("returns cloned settings so callers cannot mutate the cache", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        releaseChannels: ["stable"],
        preReleaseSubChannels: ["rc"],
      }),
    );
    const { getSettings } = await import("@/lib/storage/settings");

    const first = await getSettings();
    first.releaseChannels.push("draft");
    first.preReleaseSubChannels?.push("beta");

    const second = await getSettings();

    expect(second.releaseChannels).toEqual(["stable"]);
    expect(second.preReleaseSubChannels).toEqual(["rc"]);
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

  it("falls back to default settings and logs when settings JSON is invalid", async () => {
    fsMock.readFile.mockResolvedValue("{");
    const { getSettings } = await import("@/lib/storage/settings");

    await expect(getSettings()).resolves.toMatchObject({
      locale: "en",
      releaseChannels: ["stable"],
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Error reading or parsing settings.json:",
      expect.any(SyntaxError),
    );
  });

  it("returns the configured locale only when it is supported", async () => {
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "de" }));
    const firstModule = await import("@/lib/storage/settings");

    await expect(firstModule.getLocaleSetting()).resolves.toBe("de");

    vi.resetModules();
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ locale: "fr" }));
    const secondModule = await import("@/lib/storage/settings");

    await expect(secondModule.getLocaleSetting()).resolves.toBe("en");
  });

  it("normalizes sort settings when saving and updates the in-memory cache", async () => {
    const { getSettings, saveSettings } = await import(
      "@/lib/storage/settings"
    );

    const current = await getSettings();

    await saveSettings({
      ...current,
      releaseSortOrder: "not-real",
      providerSortOrder: ["gitlab", "bad", "github"],
    } as typeof current);

    await expect(getSettings()).resolves.toMatchObject({
      releaseSortOrder: "latest_first",
      providerSortOrder: ["gitlab", "github", "codeberg"],
    });
  });
});

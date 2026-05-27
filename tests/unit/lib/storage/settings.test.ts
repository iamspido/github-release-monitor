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

vi.mock("fs", () => ({
  promises: fsMock,
}));

vi.mock("@/lib/logger", () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
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

  it("defaults the repository form to expanded for old settings files", async () => {
    const { getSettings } = await import("@/lib/storage/settings");

    const settings = await getSettings();

    expect(settings.repositoryFormExpanded).toBe(true);
  });
});

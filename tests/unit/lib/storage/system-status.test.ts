import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = {
  mkdir: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
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

describe("storage/system-status persistence", () => {
  beforeEach(() => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue("{}");
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("fails closed when reading system status fails", async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error("boom"));
    const { getSystemStatus } = await import("@/lib/storage/system-status");

    await expect(getSystemStatus()).rejects.toThrow("boom");
  });

  it("rejects structurally invalid system status data", async () => {
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ latestKnownVersion: 42 }),
    );
    const { getSystemStatus } = await import("@/lib/storage/system-status");

    await expect(getSystemStatus()).rejects.toThrow(
      "latestKnownVersion must be a string or null",
    );
  });

  it("throws a descriptive error when saving fails", async () => {
    fsMock.writeFile.mockRejectedValueOnce(new Error("disk full"));
    const { saveSystemStatus } = await import("@/lib/storage/system-status");

    await expect(
      saveSystemStatus({
        latestKnownVersion: null,
        latestReleaseTitle: null,
        latestReleaseIsSecurity: null,
        latestSecurityVersion: null,
        lastCheckedAt: null,
        dismissedVersion: null,
        lastCheckError: null,
      }),
    ).rejects.toThrow("Could not persist system status.");
  });

  it("fails when creating the data directory is impossible", async () => {
    fsMock.mkdir.mockRejectedValueOnce(new Error("no perms"));
    const { getSystemStatus } = await import("@/lib/storage/system-status");

    await expect(getSystemStatus()).rejects.toThrow(
      "Unable to initialize system status storage directory.",
    );
  });

  it("fails when writing initial system status file is impossible", async () => {
    fsMock.access.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    fsMock.writeFile.mockRejectedValueOnce(new Error("disk full"));
    const { getSystemStatus } = await import("@/lib/storage/system-status");

    await expect(getSystemStatus()).rejects.toThrow(
      "Unable to initialize system status data file.",
    );
  });

  it("fills missing persisted fields with defaults", async () => {
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ latestKnownVersion: "2.4.0" }),
    );
    const { getSystemStatus } = await import("@/lib/storage/system-status");

    await expect(getSystemStatus()).resolves.toEqual({
      latestKnownVersion: "2.4.0",
      latestReleaseTitle: null,
      latestReleaseIsSecurity: null,
      latestSecurityVersion: null,
      lastCheckedAt: null,
      dismissedVersion: null,
      lastCheckError: null,
    });
  });

  it("serializes concurrent status updates", async () => {
    let finishFirstWrite: (() => void) | undefined;
    fsMock.readFile
      .mockResolvedValueOnce(
        JSON.stringify({
          latestKnownVersion: null,
          lastCheckedAt: null,
          dismissedVersion: null,
          lastCheckError: null,
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          latestKnownVersion: "2.4.0",
          lastCheckedAt: null,
          dismissedVersion: null,
          lastCheckError: null,
        }),
      );
    fsMock.writeFile
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirstWrite = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);
    const { updateSystemStatus } = await import("@/lib/storage/system-status");

    const first = updateSystemStatus((current) => ({
      ...current,
      latestKnownVersion: "2.4.0",
    }));
    const second = updateSystemStatus((current) => ({
      ...current,
      dismissedVersion: current.latestKnownVersion,
    }));

    await vi.waitFor(() => expect(fsMock.writeFile).toHaveBeenCalledTimes(1));
    expect(fsMock.readFile).toHaveBeenCalledTimes(1);

    finishFirstWrite?.();
    await expect(first).resolves.toMatchObject({
      latestKnownVersion: "2.4.0",
    });
    await expect(second).resolves.toMatchObject({
      latestKnownVersion: "2.4.0",
      dismissedVersion: "2.4.0",
    });
    expect(fsMock.readFile).toHaveBeenCalledTimes(2);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(2);
  });

  it("continues the update queue after a failed write", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        latestKnownVersion: null,
        lastCheckedAt: null,
        dismissedVersion: null,
        lastCheckError: null,
      }),
    );
    fsMock.writeFile
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const { updateSystemStatus } = await import("@/lib/storage/system-status");

    const failed = updateSystemStatus((current) => ({
      ...current,
      lastCheckError: "first",
    }));
    const recovered = updateSystemStatus((current) => ({
      ...current,
      lastCheckError: "second",
    }));

    await expect(failed).rejects.toThrow("Could not persist system status.");
    await expect(recovered).resolves.toMatchObject({
      lastCheckError: "second",
    });
    expect(fsMock.writeFile).toHaveBeenCalledTimes(2);
  });
});

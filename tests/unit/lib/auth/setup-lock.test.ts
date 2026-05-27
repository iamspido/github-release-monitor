import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: fsMock,
}));

function nodeError(code: string) {
  return Object.assign(new Error(code), { code });
}

describe("auth/setup-lock", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    fsMock.access.mockResolvedValue(undefined);
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        createdAt: "2024-01-01T11:59:00.000Z",
        source: "test",
      }),
    );
    fsMock.unlink.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("reports whether the permanent setup lock exists", async () => {
    const { isAuthSetupLocked } = await import("@/lib/auth/setup-lock");

    await expect(isAuthSetupLocked()).resolves.toBe(true);

    fsMock.access.mockRejectedValueOnce(nodeError("ENOENT"));

    await expect(isAuthSetupLocked()).resolves.toBe(false);
  });

  it("writes the permanent setup lock once and treats existing locks as idempotent", async () => {
    const { writeAuthSetupLock } = await import("@/lib/auth/setup-lock");

    await expect(
      writeAuthSetupLock({
        reason: "setup_completed",
        email: "admin@example.test",
        source: "setup",
      }),
    ).resolves.toBe("created");

    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("auth-setup.lock"),
      expect.stringContaining('"email": "admin@example.test"'),
      expect.objectContaining({ encoding: "utf8", flag: "wx" }),
    );

    fsMock.writeFile.mockRejectedValueOnce(nodeError("EEXIST"));

    await expect(writeAuthSetupLock({ reason: "user_exists" })).resolves.toBe(
      "already_exists",
    );
  });

  it("acquires and releases the bootstrap lock", async () => {
    const { acquireAuthSetupBootstrapLock } = await import(
      "@/lib/auth/setup-lock"
    );

    const lock = await acquireAuthSetupBootstrapLock({ source: "signup" });

    expect(lock.status).toBe("acquired");
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("auth-setup-bootstrap.lock"),
      expect.stringContaining('"source": "signup"'),
      expect.objectContaining({ encoding: "utf8", flag: "wx" }),
    );

    await lock.release();

    expect(fsMock.unlink).toHaveBeenCalledWith(
      expect.stringContaining("auth-setup-bootstrap.lock"),
    );
  });

  it("returns busy while a fresh bootstrap lock is present", async () => {
    fsMock.writeFile.mockRejectedValueOnce(nodeError("EEXIST"));
    const { acquireAuthSetupBootstrapLock } = await import(
      "@/lib/auth/setup-lock"
    );

    const lock = await acquireAuthSetupBootstrapLock();

    expect(lock.status).toBe("busy");
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("replaces a stale bootstrap lock and retries acquisition", async () => {
    fsMock.writeFile
      .mockRejectedValueOnce(nodeError("EEXIST"))
      .mockResolvedValueOnce(undefined);
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({
        createdAt: "2024-01-01T11:00:00.000Z",
        source: "stale-process",
      }),
    );
    const { acquireAuthSetupBootstrapLock } = await import(
      "@/lib/auth/setup-lock"
    );

    const lock = await acquireAuthSetupBootstrapLock({ source: "retry" });

    expect(lock.status).toBe("acquired");
    expect(fsMock.unlink).toHaveBeenCalledWith(
      expect.stringContaining("auth-setup-bootstrap.lock"),
    );
    expect(fsMock.writeFile).toHaveBeenCalledTimes(2);
  });
});

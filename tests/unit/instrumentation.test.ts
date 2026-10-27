import { existsSync, promises as fsPromises } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startBackgroundWorkersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime/background-workers", () => ({
  startBackgroundWorkers: startBackgroundWorkersMock,
}));

const STALE_MARKER_TEMP_NAME =
  ".grm-version.json.4242.0f8e3c2a-5b7d-4e1f-9a6c-2d4b8e0f1a3c.tmp";

async function writeStaleTempFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, '{"version":"2.6.1"}\n', "utf8");
  // Only the mtime is old. A fresh atime makes sure the age comes from the
  // mtime.
  const nowSeconds = Date.now() / 1000;
  await utimes(filePath, nowSeconds, nowSeconds - 60 * 60);
}

// Runs all pending promise jobs and several rounds of the event loop without
// waiting for wall-clock time.
async function flushEventLoop(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("instrumentation registration", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    startBackgroundWorkersMock.mockReset();
    // register() writes the version marker into <cwd>/data.
    tempRoot = await mkdtemp(path.join(tmpdir(), "instrumentation-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    process.env.NEXT_PUBLIC_APP_VERSION = "2.6.7";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/storage/stale-temp-files");
    vi.doUnmock("@/lib/storage/version-marker");
    if (originalRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = originalRuntime;
    }
    if (originalVersion === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("starts Node.js background workers exactly once", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");

    await register();
    await register();

    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("does not start workers for a non-Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");

    await register();

    expect(startBackgroundWorkersMock).not.toHaveBeenCalled();
  });

  it("records the app version in the data directory at a Node.js start", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");

    await register();

    await expect(
      readFile(path.join(tempRoot, "data", "grm-version.json"), "utf8"),
    ).resolves.toBe('{"version":"2.6.7"}\n');
  });

  it("does not write the version marker for a non-Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");

    await register();

    await expect(stat(path.join(tempRoot, "data"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("still starts the background workers when the data directory cannot be listed and the version marker cannot be written", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(path.join(tempRoot, "data"), "not a directory", "utf8");
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "Failed to list the data directory",
    );
    expect(String(warnSpy.mock.calls[1]?.[0])).toContain(
      "Failed to write the version marker",
    );
    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("removes stale temporary data files before it writes the version marker and starts the workers", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const markerPath = path.join(tempRoot, "data", "grm-version.json");
    const stalePath = path.join(tempRoot, "data", STALE_MARKER_TEMP_NAME);
    await writeStaleTempFile(stalePath);
    const staleAtMarkerRename: boolean[] = [];
    const realRename = fsPromises.rename.bind(fsPromises);
    vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      if (to === markerPath) {
        staleAtMarkerRename.push(existsSync(stalePath));
      }
      await realRename(from, to);
    });
    const staleAtWorkerStart: boolean[] = [];
    startBackgroundWorkersMock.mockImplementation(() => {
      staleAtWorkerStart.push(existsSync(stalePath));
    });
    const { register } = await import("@/instrumentation");

    await register();

    expect(staleAtMarkerRename).toEqual([false]);
    expect(staleAtWorkerStart).toEqual([false]);
    expect(existsSync(stalePath)).toBe(false);
    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.7"}\n',
    );
  });

  it("waits for the cleanup before it writes the version marker and starts the workers", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const cleanupStarted = Promise.withResolvers<void>();
    const cleanupFinished = Promise.withResolvers<void>();
    const removeStaleTempFilesMock = vi.fn(() => {
      cleanupStarted.resolve();
      return cleanupFinished.promise;
    });
    // Hold the cleanup at the module boundary until this test releases it.
    vi.doMock("@/lib/storage/stale-temp-files", () => ({
      removeStaleTempFiles: removeStaleTempFilesMock,
    }));
    // Load the marker writer first, so a start that does not wait for the
    // cleanup reaches it without loading another module.
    await import("@/lib/storage/version-marker");
    const mkdirSpy = vi.spyOn(fsPromises, "mkdir");
    const { register } = await import("@/instrumentation");

    const registration = register();
    try {
      await Promise.race([cleanupStarted.promise, registration]);
      expect(removeStaleTempFilesMock).toHaveBeenCalledOnce();
      await flushEventLoop();

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(startBackgroundWorkersMock).not.toHaveBeenCalled();
    } finally {
      // Finish the start inside the test. A red assertion must not let it
      // run on after afterEach has restored the working directory.
      cleanupFinished.resolve();
      await registration;
    }

    expect(mkdirSpy).toHaveBeenCalled();
    await expect(
      readFile(path.join(tempRoot, "data", "grm-version.json"), "utf8"),
    ).resolves.toBe('{"version":"2.6.7"}\n');
    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("still writes the version marker and starts the workers when a stale file cannot be removed", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stalePath = path.join(tempRoot, "data", STALE_MARKER_TEMP_NAME);
    await writeStaleTempFile(stalePath);
    // Root ignores file permissions, so the denied unlink is injected.
    vi.spyOn(fsPromises, "unlink").mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(stalePath);
    await expect(
      readFile(path.join(tempRoot, "data", "grm-version.json"), "utf8"),
    ).resolves.toBe('{"version":"2.6.7"}\n');
    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("still records the version marker and starts the workers when the cleanup module cannot be loaded", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("@/lib/storage/stale-temp-files", () => {
      throw new Error("cleanup module failed to load");
    });
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "[Startup] Failed to remove stale temporary data files:",
    );
    await expect(
      readFile(path.join(tempRoot, "data", "grm-version.json"), "utf8"),
    ).resolves.toBe('{"version":"2.6.7"}\n');
    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("still starts the workers when the version marker module cannot be loaded", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("@/lib/storage/version-marker", () => {
      throw new Error("marker module failed to load");
    });
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "[Startup] Failed to record the version marker:",
    );
    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("leaves stale temporary data files alone for a non-Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const stalePath = path.join(tempRoot, "data", STALE_MARKER_TEMP_NAME);
    await writeStaleTempFile(stalePath);
    const { register } = await import("@/instrumentation");

    await register();

    expect(existsSync(stalePath)).toBe(true);
  });
});

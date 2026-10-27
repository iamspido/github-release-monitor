import { promises as fsPromises } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MockInstance } from "vitest";
import {
  DATA_TEMP_FILE_PATTERN,
  VERSION_MARKER_FILE_NAME,
} from "@/lib/storage/data-file-names";
import { writeVersionMarker } from "@/lib/storage/version-marker";

describe("storage/version-marker", () => {
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  let tempRoot: string;
  let dataDir: string;
  let markerPath: string;
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "version-marker-"));
    dataDir = path.join(tempRoot, "data");
    markerPath = path.join(dataDir, VERSION_MARKER_FILE_NAME);
    vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_PUBLIC_APP_VERSION = "2.6.7";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalVersion === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("creates the data directory and writes exactly the app version", async () => {
    await writeVersionMarker();

    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.7"}\n',
    );
    await expect(readdir(dataDir)).resolves.toEqual([VERSION_MARKER_FILE_NAME]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("overwrites an older marker with the running version", async () => {
    await mkdir(dataDir);
    await writeFile(markerPath, '{"version":"2.6.1"}\n', "utf8");

    await writeVersionMarker();

    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.7"}\n',
    );
  });

  it("replaces the marker by renaming a temporary file from the same directory", async () => {
    await mkdir(dataDir);
    await writeFile(markerPath, '{"version":"2.6.1"}\n', "utf8");
    // A hard link keeps the old inode reachable. An in-place write would change
    // its content, an atomic rename leaves it untouched.
    const witnessPath = path.join(tempRoot, "old-marker-link.json");
    await link(markerPath, witnessPath);
    const renameSpy = vi.spyOn(fsPromises, "rename");

    await writeVersionMarker();

    await expect(readFile(witnessPath, "utf8")).resolves.toBe(
      '{"version":"2.6.1"}\n',
    );
    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.7"}\n',
    );
    expect(renameSpy).toHaveBeenCalledOnce();
    const [fromPath, toPath] = renameSpy.mock.calls[0] ?? [];
    expect(path.dirname(String(fromPath))).toBe(dataDir);
    expect(String(fromPath)).not.toBe(markerPath);
    expect(toPath).toBe(markerPath);
    await expect(readdir(dataDir)).resolves.toEqual([VERSION_MARKER_FILE_NAME]);
  });

  it("names its temporary file so the start cleanup recognizes it", async () => {
    const renameSpy = vi.spyOn(fsPromises, "rename");

    await writeVersionMarker();

    expect(renameSpy).toHaveBeenCalledOnce();
    const [fromPath] = renameSpy.mock.calls[0] ?? [];
    expect(path.basename(String(fromPath))).toMatch(DATA_TEMP_FILE_PATTERN);
  });

  it("only warns and removes the temporary file when the rename fails", async () => {
    // A non-empty directory at the marker path makes the rename fail.
    await mkdir(path.join(markerPath, "blocker"), { recursive: true });

    await expect(writeVersionMarker()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(markerPath);
    await expect(readdir(dataDir)).resolves.toEqual([VERSION_MARKER_FILE_NAME]);
  });

  it.each([
    ["the 0.0.0 fallback", undefined],
    ["an explicit 0.0.0", "0.0.0"],
    ["a prerelease", "2.6.2-rc.1"],
    ["build metadata", "2.6.2+build.7"],
    ["a v prefix", "v2.6.2"],
    ["two parts", "2.6"],
    ["an empty value", ""],
  ])("keeps the existing marker and warns for %s", async (_label, version) => {
    if (version === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = version;
    }
    await mkdir(dataDir);
    await writeFile(markerPath, '{"version":"2.6.1"}\n', "utf8");

    await expect(writeVersionMarker()).resolves.toBeUndefined();

    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.1"}\n',
    );
    await expect(readdir(dataDir)).resolves.toEqual([VERSION_MARKER_FILE_NAME]);
    expect(warnSpy).toHaveBeenCalledOnce();
    const warning = String(warnSpy.mock.calls[0]?.[0]);
    expect(warning).toContain(markerPath);
    expect(warning).toContain(`"${version ?? "0.0.0"}"`);
  });

  it("creates no marker and no data directory for a version that is not a final release", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "2.6.2-beta.1";

    await expect(writeVersionMarker()).resolves.toBeUndefined();

    await expect(readdir(tempRoot)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("writes the marker for any final release version", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "2.6.10";

    await writeVersionMarker();

    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      '{"version":"2.6.10"}\n',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("only warns when the data directory cannot be created", async () => {
    await writeFile(dataDir, "not a directory", "utf8");

    await expect(writeVersionMarker()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(markerPath);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "A later upgrade needs this file, so make sure the data directory is writable.",
    );
    await expect(readFile(dataDir, "utf8")).resolves.toBe("not a directory");
  });
});

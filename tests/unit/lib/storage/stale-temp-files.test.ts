import { promises as fsPromises } from "node:fs";
import {
  lstat,
  lutimes,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MockInstance } from "vitest";
import { removeStaleTempFiles } from "@/lib/storage/stale-temp-files";

// A whole second keeps every mtime below exact, so the 10 minute boundary is
// testable.
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const MINUTE = 60 * 1000;
const UUID = "0f8e3c2a-5b7d-4e1f-9a6c-2d4b8e0f1a3c";
const DATA_FILE_NAMES = [
  "grm-version.json",
  "settings.json",
  "repositories.json",
  "system-status.json",
];

function tempName(fileName: string, pid = "4242", uuid = UUID): string {
  return `.${fileName}.${pid}.${uuid}.tmp`;
}

function secondsAgo(ageMs: number): number {
  return (NOW - ageMs) / 1000;
}

// The atime sits on the other side of the 10 minute boundary, so only the
// mtime can decide.
async function writeAged(
  filePath: string,
  ageMs: number,
  content = "{}\n",
): Promise<void> {
  await writeFile(filePath, content, "utf8");
  const atimeAgeMs = ageMs > 10 * MINUTE ? 0 : 60 * MINUTE;
  await utimes(filePath, secondsAgo(atimeAgeMs), secondsAgo(ageMs));
}

describe("storage/stale-temp-files", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  let tempRoot: string;
  let dataDir: string;
  let warnSpy: MockInstance<typeof console.warn>;
  let logSpy: MockInstance<typeof console.log>;
  let infoSpy: MockInstance<typeof console.info>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "stale-temp-files-"));
    dataDir = path.join(tempRoot, "data");
    vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The logger writes INFO lines through console.log.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    // Only Date is fake. The files and their mtimes are real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("removes stale temporary files of all four data files and logs them in one line", async () => {
    await mkdir(dataDir);
    const staleNames = DATA_FILE_NAMES.map((name, index) =>
      tempName(name, String(index + 1)),
    );
    for (const name of staleNames) {
      await writeAged(path.join(dataDir, name), 11 * MINUTE);
    }

    await removeStaleTempFiles();

    await expect(readdir(dataDir)).resolves.toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain(
      `[DataCleanup] Removed stale temporary data files from ${dataDir}: `,
    );
    for (const name of staleNames) {
      expect(line).toContain(name);
    }
  });

  it.each([
    ["the default production log level", undefined],
    ["LOG_LEVEL=warn", "warn"],
    ["LOG_LEVEL=error", "error"],
  ])(
    "prints no removal line at %s, which hides INFO lines, and still removes the files",
    async (_label, logLevel) => {
      vi.stubEnv("NODE_ENV", "production");
      if (logLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = logLevel;
      }
      // The logger reads its level at import, so load a fresh copy.
      vi.resetModules();
      const cleanup = await import("@/lib/storage/stale-temp-files");
      await mkdir(dataDir);
      await writeAged(
        path.join(dataDir, tempName("settings.json")),
        60 * MINUTE,
      );

      await cleanup.removeStaleTempFiles();

      await expect(readdir(dataDir)).resolves.toEqual([]);
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    },
  );

  it("prints the removal line as an INFO line with LOG_LEVEL=info in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LOG_LEVEL = "info";
    vi.resetModules();
    const cleanup = await import("@/lib/storage/stale-temp-files");
    await mkdir(dataDir);
    const staleName = tempName("settings.json");
    await writeAged(path.join(dataDir, staleName), 60 * MINUTE);

    await cleanup.removeStaleTempFiles();

    await expect(readdir(dataDir)).resolves.toEqual([]);
    expect(logSpy).toHaveBeenCalledOnce();
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] \[INFO\] \[DataCleanup\] Removed stale temporary data files from /,
    );
    expect(line).toContain(staleName);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("prints no removal line with LOG_LEVEL=silent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LOG_LEVEL = "silent";
    vi.resetModules();
    const cleanup = await import("@/lib/storage/stale-temp-files");
    await mkdir(dataDir);
    await writeAged(path.join(dataDir, tempName("settings.json")), 60 * MINUTE);

    await cleanup.removeStaleTempFiles();

    await expect(readdir(dataDir)).resolves.toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("keeps temporary files that are not older than 10 minutes", async () => {
    await mkdir(dataDir);
    const exactlyTenMinutes = tempName("settings.json", "201");
    const almostTenMinutes = tempName("repositories.json", "202");
    const fromTheFuture = tempName("system-status.json", "203");
    const justOverTenMinutes = tempName("grm-version.json", "204");
    await writeAged(path.join(dataDir, exactlyTenMinutes), 10 * MINUTE);
    await writeAged(path.join(dataDir, almostTenMinutes), 10 * MINUTE - 1000);
    await writeAged(path.join(dataDir, fromTheFuture), -MINUTE);
    await writeAged(path.join(dataDir, justOverTenMinutes), 10 * MINUTE + 1000);

    await removeStaleTempFiles();

    expect((await readdir(dataDir)).sort()).toEqual(
      [exactlyTenMinutes, almostTenMinutes, fromTheFuture].sort(),
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]?.[0])).toContain(justOverTenMinutes);
  });

  it("keeps the real data files and names that only resemble a temporary file", async () => {
    await mkdir(dataDir);
    const keptNames = [
      ...DATA_FILE_NAMES,
      "auth.db",
      ".settings.json.tmp",
      tempName("settings.json", ""),
      tempName("settings.json", "abc"),
      tempName("settings.json", "4242", "0f8e3c2-5b7d-4e1f-9a6c-2d4b8e0f1a3c"),
      tempName("settings.json", "4242", UUID.toUpperCase()),
      tempName("settings.json", "4242", UUID.replaceAll("-", "")),
      tempName("settings.json", "4242", `${UUID}0`),
      tempName("jobs.json"),
      tempName("auth.db"),
      `.settingsXjson.4242.${UUID}.tmp`,
      `settings.json.4242.${UUID}.tmp`,
      `x${tempName("settings.json")}`,
      `${tempName("settings.json")}.bak`,
      ".maintenance-lock.db",
      ".migration-lock",
      `.preparing-${UUID}`,
    ];
    for (const name of keptNames) {
      await writeAged(path.join(dataDir, name), 60 * MINUTE, `${name}\n`);
    }

    await removeStaleTempFiles();

    expect((await readdir(dataDir)).sort()).toEqual([...keptNames].sort());
    for (const name of keptNames) {
      await expect(readFile(path.join(dataDir, name), "utf8")).resolves.toBe(
        `${name}\n`,
      );
    }
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("keeps a matching file in a subdirectory of the data directory", async () => {
    const subDir = path.join(dataDir, "backups");
    await mkdir(subDir, { recursive: true });
    const nestedPath = path.join(subDir, tempName("settings.json"));
    await writeAged(nestedPath, 60 * MINUTE);

    await removeStaleTempFiles();

    await expect(readdir(subDir)).resolves.toEqual([tempName("settings.json")]);
    await expect(readFile(nestedPath, "utf8")).resolves.toBe("{}\n");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("keeps a matching directory and a matching symlink and leaves the link target untouched", async () => {
    await mkdir(dataDir);
    const hourAgo = secondsAgo(60 * MINUTE);
    const directoryPath = path.join(dataDir, tempName("settings.json", "301"));
    await mkdir(directoryPath);
    await writeAged(path.join(directoryPath, "inner.txt"), 60 * MINUTE);
    await utimes(directoryPath, hourAgo, hourAgo);
    // The target is an old regular file, so following the link would make it
    // look like a stale temporary file.
    const targetPath = path.join(tempRoot, "link-target.json");
    await writeAged(targetPath, 60 * MINUTE, "target\n");
    const linkPath = path.join(dataDir, tempName("repositories.json", "302"));
    await symlink(targetPath, linkPath);
    await lutimes(linkPath, hourAgo, hourAgo);
    const targetMtimeMs = (await stat(targetPath)).mtimeMs;

    await removeStaleTempFiles();

    expect((await readdir(dataDir)).sort()).toEqual(
      [path.basename(directoryPath), path.basename(linkPath)].sort(),
    );
    expect((await lstat(directoryPath)).isDirectory()).toBe(true);
    await expect(
      readFile(path.join(directoryPath, "inner.txt"), "utf8"),
    ).resolves.toBe("{}\n");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    await expect(readlink(linkPath)).resolves.toBe(targetPath);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("target\n");
    expect((await stat(targetPath)).mtimeMs).toBe(targetMtimeMs);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("warns and goes on when a stale file cannot be removed", async () => {
    await mkdir(dataDir);
    const blockedName = tempName("settings.json", "401");
    const removableName = tempName("repositories.json", "402");
    const blockedPath = path.join(dataDir, blockedName);
    await writeAged(blockedPath, 60 * MINUTE);
    await writeAged(path.join(dataDir, removableName), 60 * MINUTE);
    const realUnlink = fsPromises.unlink.bind(fsPromises);
    // Root ignores file permissions, so the denied unlink is injected.
    vi.spyOn(fsPromises, "unlink").mockImplementation(async (target) => {
      if (target === blockedPath) {
        throw Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        });
      }
      await realUnlink(target);
    });

    await expect(removeStaleTempFiles()).resolves.toBeUndefined();

    await expect(readdir(dataDir)).resolves.toEqual([blockedName]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(blockedPath);
    expect(logSpy).toHaveBeenCalledOnce();
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain(removableName);
    expect(line).not.toContain(blockedName);
  });

  it("warns and goes on when the data directory cannot be listed", async () => {
    await writeFile(dataDir, "not a directory", "utf8");

    await expect(removeStaleTempFiles()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(dataDir);
    await expect(readFile(dataDir, "utf8")).resolves.toBe("not a directory");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("stays silent and creates nothing when the data directory does not exist yet", async () => {
    await expect(removeStaleTempFiles()).resolves.toBeUndefined();

    await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

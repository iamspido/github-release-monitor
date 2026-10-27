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
import { logger } from "@/lib/logger";
import { writeFileAtomically } from "@/lib/storage/atomic-write";
import { DATA_TEMP_FILE_PATTERN } from "@/lib/storage/data-file-names";

describe("storage/atomic-write", () => {
  const log = logger.withScope("AtomicWriteTest");
  let dir: string;
  let filePath: string;
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "atomic-write-"));
    filePath = path.join(dir, "settings.json");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  // Records the flushes, closes and the rename, and can inject a failure for
  // opening or flushing the temporary file or the directory.
  function recordWriteSteps(failures: Record<string, Error> = {}): string[] {
    const events: string[] = [];
    const labelOf = (target: unknown) =>
      String(target) === dir
        ? "directory"
        : DATA_TEMP_FILE_PATTERN.test(path.basename(String(target)))
          ? "temporary file"
          : String(target);
    const realOpen = fsPromises.open.bind(fsPromises);
    vi.spyOn(fsPromises, "open").mockImplementation(
      async (target, flags, mode) => {
        const label = labelOf(target);
        const openFailure = failures[`open ${label}`];
        if (openFailure) throw openFailure;
        const handle = await realOpen(target, flags, mode);
        const realSync = handle.sync.bind(handle);
        const realClose = handle.close.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          events.push(`sync ${label}`);
          const syncFailure = failures[`sync ${label}`];
          if (syncFailure) throw syncFailure;
          await realSync();
        });
        vi.spyOn(handle, "close").mockImplementation(async () => {
          events.push(`close ${label}`);
          await realClose();
        });
        return handle;
      },
    );
    const realRename = fsPromises.rename.bind(fsPromises);
    vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      events.push("rename");
      await realRename(from, to);
    });
    return events;
  }

  function errnoError(code: string): Error {
    return Object.assign(new Error(`${code}: injected`), { code });
  }

  it("writes a new file and leaves no temporary file", async () => {
    await writeFileAtomically(filePath, "new\n", log);

    await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
    await expect(readdir(dir)).resolves.toEqual(["settings.json"]);
  });

  it("replaces an existing file by renaming a temporary file from the same directory", async () => {
    await writeFile(filePath, "old\n", "utf8");
    // A hard link keeps the old inode reachable. An in-place write would change
    // its content, an atomic rename leaves it untouched.
    const witnessPath = path.join(dir, "witness");
    await link(filePath, witnessPath);
    const renameSpy = vi.spyOn(fsPromises, "rename");

    await writeFileAtomically(filePath, "new\n", log);

    await expect(readFile(witnessPath, "utf8")).resolves.toBe("old\n");
    await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
    expect(renameSpy).toHaveBeenCalledOnce();
    const [fromPath, toPath] = renameSpy.mock.calls[0] ?? [];
    expect(path.dirname(String(fromPath))).toBe(dir);
    expect(path.basename(String(fromPath))).toMatch(DATA_TEMP_FILE_PATTERN);
    expect(toPath).toBe(filePath);
  });

  it("removes the temporary file and throws the error when the rename fails", async () => {
    // A non-empty directory at the target makes the rename fail.
    await mkdir(path.join(filePath, "blocker"), { recursive: true });

    const failure = writeFileAtomically(filePath, "new\n", log);

    await expect(failure).rejects.toMatchObject({ syscall: "rename" });

    await expect(readdir(dir)).resolves.toEqual(["settings.json"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when the temporary file cannot be removed and still throws the original error", async () => {
    await mkdir(path.join(filePath, "blocker"), { recursive: true });
    const cleanupError = Object.assign(new Error("EBUSY: resource busy"), {
      code: "EBUSY",
    });
    vi.spyOn(fsPromises, "rm").mockRejectedValue(cleanupError);

    let failure: unknown;
    try {
      await writeFileAtomically(filePath, "new\n", log);
    } catch (error) {
      failure = error;
    }

    expect(failure).not.toBe(cleanupError);
    expect(failure).toMatchObject({ syscall: "rename" });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(
      /\[AtomicWriteTest\] Failed to remove temporary data file at .*\.settings\.json\.\d+\.[0-9a-f-]{36}\.tmp:$/,
    );
    expect(warnSpy.mock.calls[0]?.[1]).toBe(cleanupError);
  });

  it("flushes the temporary file before the rename and the directory after it", async () => {
    const events = recordWriteSteps();

    await writeFileAtomically(filePath, "new\n", log);

    expect(events).toEqual([
      "sync temporary file",
      "close temporary file",
      "rename",
      "sync directory",
      "close directory",
    ]);
    await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
  });

  it("keeps the old file and removes the temporary file when the flush fails", async () => {
    await writeFile(filePath, "old\n", "utf8");
    const flushError = errnoError("EIO");
    const events = recordWriteSteps({ "sync temporary file": flushError });

    await expect(writeFileAtomically(filePath, "new\n", log)).rejects.toBe(
      flushError,
    );

    expect(events).toEqual(["sync temporary file", "close temporary file"]);
    await expect(readFile(filePath, "utf8")).resolves.toBe("old\n");
    await expect(readdir(dir)).resolves.toEqual(["settings.json"]);
  });

  it.each([
    ["a directory flush is not supported", "sync directory", "EINVAL"],
    ["a directory cannot be opened", "open directory", "EISDIR"],
  ])("still succeeds when %s", async (_label, step, code) => {
    recordWriteSteps({ [step]: errnoError(code) });

    await expect(
      writeFileAtomically(filePath, "new\n", log),
    ).resolves.toBeUndefined();

    await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports any other failed directory flush after the rename", async () => {
    const flushError = errnoError("EIO");
    const events = recordWriteSteps({ "sync directory": flushError });

    await expect(writeFileAtomically(filePath, "new\n", log)).rejects.toBe(
      flushError,
    );

    expect(events).toContain("close directory");
    await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
    await expect(readdir(dir)).resolves.toEqual(["settings.json"]);
  });
});

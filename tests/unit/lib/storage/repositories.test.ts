import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Repository } from "@/types";

describe("storage/repositories", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grm-repos-"));
    // @ts-expect-error
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    // @ts-expect-error
    process.cwd.mockRestore?.();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("initializes repositories file and supports round-trip", async () => {
    const { getRepositories, saveRepositories } = await import(
      "@/lib/storage/repositories"
    );

    const initial = await getRepositories();
    expect(Array.isArray(initial)).toBe(true);
    expect(initial.length).toBe(0);

    const list = [
      { id: "owner1/repo1", url: "https://github.com/owner1/repo1" },
      {
        id: "owner2/repo2",
        url: "https://github.com/owner2/repo2",
        isNew: true,
      },
    ];
    await saveRepositories(list);

    const after = await getRepositories();
    expect(after).toEqual([
      { id: "github:owner1/repo1", url: "https://github.com/owner1/repo1" },
      {
        id: "github:owner2/repo2",
        url: "https://github.com/owner2/repo2",
        isNew: true,
      },
    ]);
  });

  it("returns empty array on corrupt json and throws detailed write error", async () => {
    const mod = await import("@/lib/storage/repositories");
    const { getRepositories, saveRepositories } = mod;

    // Prime file
    await saveRepositories([]);
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      "{bad-json",
      "utf8",
    );

    const repos = await getRepositories();
    expect(repos).toEqual([]);

    // Mock fs.writeFile to fail
    const writeSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("EACCES"), { code: "EACCES" }),
      );
    const repository: Repository = {
      id: "a/b",
      url: "https://github.com/a/b",
    };
    await expect(saveRepositories([repository])).rejects.toThrow(
      /Failed to write/,
    );
    writeSpy.mockRestore();
  });
});

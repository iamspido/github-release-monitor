import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Repository } from "@/types";

describe("storage/repositories", () => {
  let tmpDir: string;
  let cwdSpy: { mockRestore: () => void };

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grm-repos-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
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
        displayName: "  Media Stack  ",
        isNew: true,
        isPinned: true,
        tags: [" Infra ", "MEDIA", "infra"],
      },
    ];
    await saveRepositories(list);

    const after = await getRepositories();
    expect(after).toEqual([
      { id: "github:owner1/repo1", url: "https://github.com/owner1/repo1" },
      {
        id: "github:owner2/repo2",
        url: "https://github.com/owner2/repo2",
        displayName: "Media Stack",
        isNew: true,
        isPinned: true,
        tags: ["infra", "media"],
      },
    ]);
  });

  it("fails closed on corrupt json and throws detailed write error", async () => {
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

    await expect(getRepositories()).rejects.toBeInstanceOf(SyntaxError);

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

  it("rejects structurally invalid repository data", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          releaseChannels: ["stable", "unexpected"],
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).rejects.toThrow(
      "releaseChannels must be an array of release channels",
    );
  });

  it("migrates explicitly selected legacy short channels to custom markers", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          preReleaseSubChannels: ["a", "beta", "b", "m"],
          customPreReleaseMarkers: [" Testing ", "testing", "EDGE"],
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).resolves.toEqual([
      expect.objectContaining({
        preReleaseSubChannels: ["beta"],
        customPreReleaseMarkers: ["testing", "edge", "a", "b", "m"],
      }),
    ]);
  });

  it("preserves a legacy short-channel-only repository configuration", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          preReleaseSubChannels: ["b"],
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).resolves.toEqual([
      expect.objectContaining({
        preReleaseSubChannels: [],
        customPreReleaseMarkers: ["b"],
      }),
    ]);
  });

  it("rejects invalid persisted custom pre-release markers", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          customPreReleaseMarkers: ["."],
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).rejects.toThrow(
      "customPreReleaseMarkers contains invalid markers",
    );
  });

  it("rejects invalid persisted repository tags", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          tags: ["bad,tag"],
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).rejects.toThrow(
      "tags contains invalid repository tags",
    );
  });

  it("rejects invalid persisted repository display names", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          displayName: "x".repeat(101),
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).rejects.toThrow(
      "displayName must be a valid display name",
    );
  });

  it("rejects a non-boolean pinned state", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          isPinned: "true",
        },
      ]),
      "utf8",
    );
    const { getRepositories } = await import("@/lib/storage/repositories");

    await expect(getRepositories()).rejects.toThrow(
      "isPinned must be a boolean",
    );
  });

  it("round-trips and validates pending notification deliveries", async () => {
    const { getRepositories, saveRepositories } = await import(
      "@/lib/storage/repositories"
    );
    const createdAt = "2026-07-14T00:00:00.000Z";
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      pendingNotifications: [
        {
          id: "github%3Aowner%2Frepo:v2",
          repository: {
            id: "github:owner/repo",
            url: "https://github.com/owner/repo",
          },
          release: {
            id: 2,
            html_url: "https://github.com/owner/repo/releases/tag/v2",
            tag_name: "v2",
            name: "v2",
            body: "notes",
            created_at: createdAt,
            published_at: createdAt,
            prerelease: false,
            draft: false,
          },
          locale: "en",
          settings: { timeFormat: "24h" },
          channels: ["email"],
          createdAt,
          attempts: 1,
          nextAttemptAt: "2026-07-14T00:01:00.000Z",
        },
      ],
    };

    await saveRepositories([repository]);
    await expect(getRepositories()).resolves.toEqual([repository]);

    const dataFile = path.join(tmpDir, "data", "repositories.json");
    const invalid = JSON.parse(await fs.readFile(dataFile, "utf8"));
    invalid[0].pendingNotifications[0].channels = ["unknown"];
    await fs.writeFile(dataFile, JSON.stringify(invalid), "utf8");

    await expect(getRepositories()).rejects.toThrow(
      "channels must contain notification channels",
    );
  });

  it("preserves null repository overrides while merging duplicate migrated ids", async () => {
    const { getRepositories } = await import("@/lib/storage/repositories");
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([
        {
          id: "owner/repo",
          url: "https://github.com/owner/repo",
          releasesPerPage: null,
          refreshInterval: null,
          cacheInterval: null,
          backgroundCheckCron: null,
          includeRegex: "base-only",
          releaseSelectionStrategy: "highest_version",
          versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
        },
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
          releasesPerPage: 50,
          refreshInterval: 30,
          cacheInterval: 15,
          backgroundCheckCron: "0 21 * * *",
          excludeRegex: "incoming-only",
        },
      ] satisfies Repository[]),
      "utf8",
    );

    const repos = await getRepositories();

    expect(repos).toEqual([
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        releasesPerPage: null,
        refreshInterval: null,
        cacheInterval: null,
        backgroundCheckCron: null,
        includeRegex: "base-only",
        excludeRegex: "incoming-only",
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    ]);
  });
});

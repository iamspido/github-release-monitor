import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PendingReleaseNotification, Repository } from "@/types";

function createPendingNotification(): PendingReleaseNotification {
  const createdAt = "2026-07-14T00:00:00.000Z";
  return {
    id: "github%3Aowner%2Frepo:v2",
    batchId: "check-1",
    repository: {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      appriseTags: "operations",
      appriseFormat: "markdown",
    },
    release: {
      id: 2,
      html_url: "https://github.com/owner/repo/releases/tag/v2",
      tag_name: "v2",
      name: "v2",
      body: "Commit deadbee",
      commit_links: [
        {
          ref: "deadbee",
          sha: `deadbee${"a".repeat(33)}`,
          url: `https://github.com/owner/repo/commit/deadbee${"a".repeat(33)}`,
        },
      ],
      commit_links_resolved_at: createdAt,
      created_at: createdAt,
      published_at: createdAt,
      prerelease: false,
      draft: false,
    },
    locale: "en",
    settings: {
      timeFormat: "24h",
      emailNotificationMode: "batch",
      appriseNotificationMode: "batch",
      emailIncludeReleaseNotes: true,
      appriseIncludeReleaseNotes: false,
      appriseMaxCharacters: 1800,
      appriseTags: "operations",
      appriseFormat: "markdown",
    },
    channels: ["email", "apprise"],
    channelStates: {
      email: { attempts: 0 },
      apprise: {
        attempts: 1,
        nextAttemptAt: "2026-07-14T00:01:00.000Z",
      },
    },
    createdAt,
    attempts: 1,
    nextAttemptAt: "2026-07-14T00:01:00.000Z",
  };
}

function createLegacyPendingNotification(): PendingReleaseNotification {
  const notification = createPendingNotification();
  delete notification.batchId;
  delete notification.channelStates;
  delete notification.settings.emailNotificationMode;
  delete notification.settings.appriseNotificationMode;
  notification.channels = ["email"];
  return notification;
}

type InvalidPendingNotificationCase = {
  name: string;
  mutate: (notification: Record<string, unknown>) => void;
  expectedError: string;
};

const invalidPendingNotificationCases: InvalidPendingNotificationCase[] = [
  {
    name: "non-string batch ids",
    mutate: (notification) => {
      notification.batchId = 123;
    },
    expectedError: "batchId must be a string",
  },
  {
    name: "non-object channel states",
    mutate: (notification) => {
      notification.channelStates = "invalid";
    },
    expectedError: "channelStates must be an object",
  },
  {
    name: "invalid channel attempt counts",
    mutate: (notification) => {
      notification.channelStates = { email: { attempts: "one" } };
    },
    expectedError:
      "channelStates.email.attempts must be a non-negative integer",
  },
  {
    name: "fractional legacy attempt counts",
    mutate: (notification) => {
      notification.attempts = 1.5;
    },
    expectedError: "attempts must be a non-negative integer",
  },
  {
    name: "fractional channel attempt counts",
    mutate: (notification) => {
      notification.channelStates = { email: { attempts: 1.5 } };
    },
    expectedError:
      "channelStates.email.attempts must be a non-negative integer",
  },
  {
    name: "invalid channel retry timestamps",
    mutate: (notification) => {
      notification.channelStates = {
        email: { attempts: 1, nextAttemptAt: 123 },
      };
    },
    expectedError: "nextAttemptAt must be a string",
  },
  {
    name: "invalid email notification modes",
    mutate: (notification) => {
      const settings = notification.settings as Record<string, unknown>;
      settings.emailNotificationMode = "simple";
    },
    expectedError: "emailNotificationMode must be per_release or batch",
  },
  {
    name: "invalid Apprise notification modes",
    mutate: (notification) => {
      const settings = notification.settings as Record<string, unknown>;
      settings.appriseNotificationMode = "digest";
    },
    expectedError: "appriseNotificationMode must be per_release or batch",
  },
];

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

  it("round-trips resolved commit-link metadata and discards invalid derived state", async () => {
    const { getRepositories, saveRepositories } = await import(
      "@/lib/storage/repositories"
    );
    const resolvedAt = "2026-07-14T00:00:00.000Z";
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      latestRelease: {
        html_url: "https://github.com/owner/repo/releases/tag/v1",
        tag_name: "v1",
        name: "v1",
        body: "Commit deadbee",
        commit_links: [
          {
            ref: "deadbee",
            sha: `deadbee${"a".repeat(33)}`,
            url: `https://github.com/owner/repo/commit/deadbee${"a".repeat(33)}`,
          },
        ],
        commit_links_resolved_at: resolvedAt,
        created_at: resolvedAt,
        published_at: resolvedAt,
      },
    };

    await saveRepositories([repository]);
    await expect(getRepositories()).resolves.toEqual([repository]);

    const dataFile = path.join(tmpDir, "data", "repositories.json");
    const invalid = JSON.parse(await fs.readFile(dataFile, "utf8"));
    delete invalid[0].latestRelease.commit_links;
    await fs.writeFile(dataFile, JSON.stringify(invalid), "utf8");

    const repositories = await getRepositories();
    expect(repositories[0].latestRelease).not.toHaveProperty("commit_links");
    expect(repositories[0].latestRelease).not.toHaveProperty(
      "commit_links_resolved_at",
    );
    expect(repositories[0].latestRelease).not.toHaveProperty(
      "commit_links_retry",
    );
  });

  it("loads legacy nullable commit-link metadata in cached and pending releases", async () => {
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(dataDir, { recursive: true });
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
    };
    repository.latestRelease = {
      html_url: "https://github.com/owner/repo/releases/tag/v1",
      tag_name: "v1",
      name: "v1",
      body: "Commit deadbee",
      created_at: "2026-07-14T00:00:00.000Z",
      published_at: "2026-07-14T00:00:00.000Z",
    };
    repository.pendingNotifications = [createPendingNotification()];
    const rawRepository = repository as unknown as Record<string, unknown>;
    const rawLatestRelease = rawRepository.latestRelease as Record<
      string,
      unknown
    >;
    rawLatestRelease.commit_links = null;
    rawLatestRelease.commit_links_resolved_at = null;
    const rawPendingRelease = (
      rawRepository.pendingNotifications as Array<Record<string, unknown>>
    )[0].release as Record<string, unknown>;
    rawPendingRelease.commit_links = null;

    await fs.writeFile(
      path.join(dataDir, "repositories.json"),
      JSON.stringify([rawRepository]),
      "utf8",
    );

    const { getRepositories } = await import("@/lib/storage/repositories");
    const repositories = await getRepositories();

    expect(repositories[0].latestRelease).not.toHaveProperty("commit_links");
    expect(repositories[0].latestRelease).not.toHaveProperty(
      "commit_links_resolved_at",
    );
    expect(
      repositories[0].pendingNotifications?.[0].release,
    ).not.toHaveProperty("commit_links");
    expect(repositories[0].pendingNotifications).toHaveLength(1);
  });

  it("round-trips partial commit-link metadata with retry progress", async () => {
    const { getRepositories, saveRepositories } = await import(
      "@/lib/storage/repositories"
    );
    const sha = `deadbee${"a".repeat(33)}`;
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      latestRelease: {
        html_url: "https://github.com/owner/repo/releases/tag/v1",
        tag_name: "v1",
        name: "v1",
        body: "Commits deadbee and 1234567",
        commit_links: [
          {
            ref: "deadbee",
            sha,
            url: `https://github.com/owner/repo/commit/${sha}`,
          },
        ],
        commit_links_retry: {
          attempts: 0,
          retry_at: "2026-07-14T00:15:00.000Z",
          checked_refs: ["deadbee"],
        },
        created_at: "2026-07-14T00:00:00.000Z",
        published_at: "2026-07-14T00:00:00.000Z",
      },
    };

    await saveRepositories([repository]);

    await expect(getRepositories()).resolves.toEqual([repository]);
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
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      pendingNotifications: [createPendingNotification()],
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

  it("round-trips pending notifications in the legacy queue format", async () => {
    const { getRepositories, saveRepositories } = await import(
      "@/lib/storage/repositories"
    );
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      pendingNotifications: [createLegacyPendingNotification()],
    };

    await saveRepositories([repository]);

    await expect(getRepositories()).resolves.toEqual([repository]);
  });

  it.each(invalidPendingNotificationCases)(
    "rejects $name",
    async ({ mutate, expectedError }) => {
      const dataDir = path.join(tmpDir, "data");
      await fs.mkdir(dataDir, { recursive: true });
      const notification = structuredClone(
        createPendingNotification(),
      ) as unknown as Record<string, unknown>;
      mutate(notification);
      await fs.writeFile(
        path.join(dataDir, "repositories.json"),
        JSON.stringify([
          {
            id: "github:owner/repo",
            url: "https://github.com/owner/repo",
            pendingNotifications: [notification],
          },
        ]),
        "utf8",
      );
      const { getRepositories } = await import("@/lib/storage/repositories");

      await expect(getRepositories()).rejects.toThrow(expectedError);
    },
  );

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

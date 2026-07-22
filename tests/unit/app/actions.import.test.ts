// vitest globals enabled

import type { Repository } from "@/types";

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
  getLocale: async () => "en",
}));

// In-memory repository store
const mem: { repos: Repository[] } = { repos: [] };
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => ({
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    parallelRepoFetches: 5,
    releaseChannels: ["stable"],
    showAcknowledge: true,
  }),
}));

vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

describe("importRepositoriesAction idempotency", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [
      {
        id: "github:owner1/repo1",
        url: "https://github.com/owner1/repo1",
        isNew: false,
      },
    ];
  });

  it("adds new and updates existing repos idempotently", async () => {
    const actions = await import("@/app/actions");

    const imported: Repository[] = [
      {
        id: "owner1/repo1",
        url: "https://github.com/owner1/repo1",
        isNew: true,
      }, // existing
      { id: "owner2/repo2", url: "https://github.com/owner2/repo2" }, // new
    ];

    const res = await actions.importRepositoriesAction(imported);
    expect(res.success).toBe(true);
    // Final list contains both, with merged fields
    expect(mem.repos.find((r) => r.id === "github:owner1/repo1")).toBeTruthy();
    expect(mem.repos.find((r) => r.id === "github:owner2/repo2")).toBeTruthy();
  });

  it("does not import internal notification delivery state", async () => {
    const actions = await import("@/app/actions");
    const imported = [
      {
        id: "owner2/repo2",
        url: "https://github.com/owner2/repo2",
        pendingNotifications: [{ id: "injected-delivery" }],
        injectedField: "must-not-persist",
      },
    ] as unknown as Repository[];

    const result = await actions.importRepositoriesAction(imported);

    expect(result.success).toBe(true);
    expect(
      mem.repos.find((repo) => repo.id === "github:owner2/repo2"),
    ).not.toHaveProperty("pendingNotifications");
    expect(
      mem.repos.find((repo) => repo.id === "github:owner2/repo2"),
    ).not.toHaveProperty("injectedField");
  });

  it("keeps supported v2 export fields while normalizing the repository", async () => {
    const actions = await import("@/app/actions");
    const imported = [
      {
        id: "legacy-id-is-ignored",
        url: "https://github.com/Owner/Repo.git",
        isNew: true,
        etag: '"etag"',
        releaseChannels: ["stable"],
        refreshInterval: 30,
        appriseFormat: "markdown",
      },
    ] as Repository[];

    const result = await actions.importRepositoriesAction(imported);

    expect(result.success).toBe(true);
    expect(mem.repos).toContainEqual(
      expect.objectContaining({
        id: "github:owner/repo",
        url: "https://github.com/Owner/Repo",
        isNew: true,
        etag: '"etag"',
        releaseChannels: ["stable"],
        refreshInterval: 30,
        appriseFormat: "markdown",
      }),
    );
  });

  it("rebaselines an existing repository when an import changes its selection strategy", async () => {
    mem.repos[0] = {
      ...mem.repos[0],
      etag: 'W/"old"',
      lastSeenReleaseTag: "v1.0.0",
      isNew: true,
    };
    const actions = await import("@/app/actions");

    const result = await actions.importRepositoriesAction([
      {
        id: "ignored",
        url: "https://github.com/owner1/repo1",
        releaseSelectionStrategy: "highest_version",
      },
    ]);

    expect(result.success).toBe(true);
    expect(mem.repos[0]).toMatchObject({
      releaseSelectionStrategy: "highest_version",
      isNew: false,
    });
    expect(mem.repos[0].lastSeenReleaseTag).toBeUndefined();
    expect(mem.repos[0].etag).toBeUndefined();
  });

  it("preserves explicitly imported release state with a changed selection strategy", async () => {
    mem.repos[0] = {
      ...mem.repos[0],
      etag: 'W/"old"',
      lastSeenReleaseTag: "v1.0.0",
    };
    const actions = await import("@/app/actions");

    const result = await actions.importRepositoriesAction([
      {
        id: "ignored",
        url: "https://github.com/owner1/repo1",
        releaseSelectionStrategy: "highest_version",
        etag: 'W/"imported"',
        lastSeenReleaseTag: "v9.0.0",
      },
    ]);

    expect(result.success).toBe(true);
    expect(mem.repos[0]).toMatchObject({
      releaseSelectionStrategy: "highest_version",
      etag: 'W/"imported"',
      lastSeenReleaseTag: "v9.0.0",
    });
  });

  it("rebaselines an existing repository when an import changes its version tag pattern", async () => {
    mem.repos[0] = {
      ...mem.repos[0],
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^old/(?<version>\\d+\\.\\d+\\.\\d+)$",
      etag: 'W/"old"',
      lastSeenReleaseTag: "old/1.0.0",
      isNew: true,
    };
    const actions = await import("@/app/actions");
    const nextPattern = "^new/(?<version>\\d+\\.\\d+\\.\\d+)$";

    const result = await actions.importRepositoriesAction([
      {
        id: "ignored",
        url: "https://github.com/owner1/repo1",
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: nextPattern,
      },
    ]);

    expect(result.success).toBe(true);
    expect(mem.repos[0].versionTagPattern).toBe(nextPattern);
    expect(mem.repos[0].lastSeenReleaseTag).toBeUndefined();
    expect(mem.repos[0].etag).toBeUndefined();
    expect(mem.repos[0].isNew).toBe(false);
  });

  it("adds batch tags without replacing tags on an existing repository", async () => {
    mem.repos[0].tags = ["existing", "shared"];
    const actions = await import("@/app/actions");

    const result = await actions.importRepositoriesAction(
      [
        {
          id: "owner1/repo1",
          url: "https://github.com/owner1/repo1",
          tags: ["file-tag", "shared"],
        },
      ],
      ["batch-tag", "shared"],
    );

    expect(result.success).toBe(true);
    expect(mem.repos[0].tags).toEqual([
      "existing",
      "shared",
      "file-tag",
      "batch-tag",
    ]);
  });

  it("rejects batch tags when the merged repository exceeds the tag limit", async () => {
    mem.repos[0].tags = Array.from(
      { length: 20 },
      (_, index) => `tag-${index}`,
    );
    const actions = await import("@/app/actions");

    const result = await actions.importRepositoriesAction(
      [
        {
          id: "owner1/repo1",
          url: "https://github.com/owner1/repo1",
        },
      ],
      ["one-more"],
    );

    expect(result).toEqual({
      success: false,
      message: "tags_error_invalid",
    });
    expect(mem.repos[0].tags).toHaveLength(20);
  });
});

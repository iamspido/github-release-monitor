// vitest globals are enabled via vitest.config.ts

import type { Repository } from "@/types";

const { state, sendNotificationMock } = vi.hoisted(() => ({
  state: {
    repositories: [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        lastSeenReleaseTag: "v1",
      },
    ] as Repository[],
    releaseId: 2,
    releaseTag: "v2",
    fetchErrorType: undefined as "not_modified" | undefined,
  },
  sendNotificationMock: vi.fn(),
}));

vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => state.repositories,
  saveRepositories: async (repositories: Repository[]) => {
    state.repositories = structuredClone(repositories);
  },
}));

vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => ({
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    parallelRepoFetches: 1,
    releaseChannels: ["stable"],
    showAcknowledge: true,
  }),
}));

vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async (repositories: Repository[]) =>
    repositories.map((repository) => ({
      repoId: repository.id,
      repoUrl: repository.url,
      release: {
        id: state.releaseId,
        html_url: `${repository.url}/releases/tag/${state.releaseTag}`,
        tag_name: state.releaseTag,
        name:
          state.releaseId === 0 ? `Tag: ${state.releaseTag}` : state.releaseTag,
        body: null,
        created_at: "2026-07-14T00:00:00.000Z",
        published_at: "2026-07-14T00:00:00.000Z",
        prerelease: false,
        draft: false,
      },
      ...(state.fetchErrorType
        ? { error: { type: state.fetchErrorType } }
        : {}),
    })),
}));

vi.mock("@/lib/notifications", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    getConfiguredNotificationChannels: () => ["apprise"],
    sendNotification: sendNotificationMock,
  };
});

import { checkForNewReleases } from "@/lib/releases/checker";
import { scheduleTask } from "@/lib/runtime/task-scheduler";

describe("release checker scheduling", () => {
  beforeEach(() => {
    state.repositories = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        lastSeenReleaseTag: "v1",
      },
    ];
    state.releaseId = 2;
    state.releaseTag = "v2";
    state.fetchErrorType = undefined;
    sendNotificationMock.mockReset();
  });

  it("uses the first tag fallback as the notification baseline", async () => {
    state.repositories = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
      },
    ];
    state.releaseId = 0;

    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 0 });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(state.repositories[0]).toMatchObject({
      lastSeenReleaseTag: "v2",
      isNew: false,
      latestRelease: expect.objectContaining({
        tag_name: "v2",
        source: "tag",
      }),
    });
  });

  it("detects and notifies for a new tag fallback", async () => {
    state.releaseId = 0;
    sendNotificationMock.mockResolvedValue(undefined);

    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 1 });

    expect(sendNotificationMock).toHaveBeenCalledOnce();
    expect(state.repositories[0]).toMatchObject({
      lastSeenReleaseTag: "v2",
      isNew: true,
    });
  });

  it("does not treat a reconstructed not-modified result as new", async () => {
    state.repositories = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        lastSeenReleaseTag: "v1",
        latestRelease: {
          html_url: "https://github.com/owner/repo/releases/tag/v2",
          tag_name: "v2",
          name: "v2",
          body: null,
          created_at: "2026-07-14T00:00:00.000Z",
          published_at: "2026-07-14T00:00:00.000Z",
          source: "release",
        },
      },
    ];
    state.releaseId = 0;
    state.fetchErrorType = "not_modified";

    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 0 });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(state.repositories[0].lastSeenReleaseTag).toBe("v1");
  });

  it("assigns one batch id to all releases detected in the same check", async () => {
    state.repositories = [
      {
        id: "github:owner/repo-a",
        url: "https://github.com/owner/repo-a",
        lastSeenReleaseTag: "v1",
      },
      {
        id: "github:owner/repo-b",
        url: "https://github.com/owner/repo-b",
        lastSeenReleaseTag: "v1",
      },
    ];
    const finishDeliveries: Array<() => void> = [];
    sendNotificationMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDeliveries.push(resolve);
        }),
    );

    const check = checkForNewReleases({ skipCache: true });
    await vi.waitFor(() =>
      expect(sendNotificationMock).toHaveBeenCalledTimes(2),
    );

    const batchIds = state.repositories.map(
      (repository) => repository.pendingNotifications?.[0]?.batchId,
    );
    expect(batchIds[0]).toBeTruthy();
    expect(batchIds[1]).toBe(batchIds[0]);

    finishDeliveries.forEach((finish) => {
      finish();
    });
    await expect(check).resolves.toMatchObject({ notificationsSent: 2 });
  });

  it("assigns different batch ids to releases detected in separate checks", async () => {
    sendNotificationMock.mockRejectedValue(new Error("Apprise unavailable"));

    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 0 });
    const firstBatchId = state.repositories[0].pendingNotifications?.find(
      (notification) => notification.release.tag_name === "v2",
    )?.batchId;

    state.releaseId = 3;
    state.releaseTag = "v3";
    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 0 });
    const secondBatchId = state.repositories[0].pendingNotifications?.find(
      (notification) => notification.release.tag_name === "v3",
    )?.batchId;

    expect(firstBatchId).toBeTruthy();
    expect(secondBatchId).toBeTruthy();
    expect(secondBatchId).not.toBe(firstBatchId);
  });

  it("releases the shared state scheduler before notification I/O", async () => {
    let finishDelivery: (() => void) | undefined;
    sendNotificationMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelivery = resolve;
        }),
    );

    const checkPromise = checkForNewReleases({ skipCache: true });
    await vi.waitFor(() => expect(sendNotificationMock).toHaveBeenCalled());

    await expect(
      scheduleTask("concurrent state update", async () => "completed"),
    ).resolves.toBe("completed");

    expect(finishDelivery).toBeTypeOf("function");
    finishDelivery?.();
    await expect(checkPromise).resolves.toMatchObject({ notificationsSent: 1 });
  });

  it("persists abandoned-notification pruning without delivery outcomes", async () => {
    state.repositories = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        lastSeenReleaseTag: "v2",
        pendingNotifications: [
          {
            id: "expired",
            repository: {
              id: "github:owner/repo",
              url: "https://github.com/owner/repo",
            },
            release: {
              id: 2,
              html_url: "https://github.com/owner/repo/releases/tag/v2",
              tag_name: "v2",
              name: "v2",
              body: null,
              created_at: "2020-01-01T00:00:00.000Z",
              published_at: "2020-01-01T00:00:00.000Z",
              prerelease: false,
              draft: false,
            },
            locale: "en",
            settings: { timeFormat: "24h" },
            channels: ["apprise"],
            createdAt: "2020-01-01T00:00:00.000Z",
            attempts: 10,
            abandonedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
      },
    ];

    await expect(
      checkForNewReleases({ skipCache: true }),
    ).resolves.toMatchObject({ notificationsSent: 0 });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(state.repositories[0].pendingNotifications).toBeUndefined();
  });

  it("deduplicates pending delivery across separately loaded checker modules", async () => {
    state.repositories = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        lastSeenReleaseTag: "v2",
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
              body: null,
              created_at: "2026-07-14T00:00:00.000Z",
              published_at: "2026-07-14T00:00:00.000Z",
              prerelease: false,
              draft: false,
            },
            locale: "en",
            settings: { timeFormat: "24h" },
            channels: ["apprise"],
            createdAt: "2026-07-14T00:00:00.000Z",
            attempts: 0,
          },
        ],
      },
    ];
    let finishDelivery: (() => void) | undefined;
    sendNotificationMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelivery = resolve;
        }),
    );

    const firstChecker = await import("@/lib/releases/checker");
    vi.resetModules();
    const secondChecker = await import("@/lib/releases/checker");

    const firstCheck = firstChecker.checkForNewReleases({ skipCache: true });
    await vi.waitFor(() => expect(sendNotificationMock).toHaveBeenCalledOnce());

    const secondCheck = secondChecker.checkForNewReleases({ skipCache: true });
    await scheduleTask("wait for second release check", async () => undefined);
    expect(sendNotificationMock).toHaveBeenCalledOnce();

    finishDelivery?.();
    const results = await Promise.all([firstCheck, secondCheck]);

    expect(sendNotificationMock).toHaveBeenCalledOnce();
    expect(
      results.map(({ notificationsSent }) => notificationsSent).sort(),
    ).toEqual([0, 1]);
    expect(state.repositories[0].pendingNotifications).toBeUndefined();
  });
});

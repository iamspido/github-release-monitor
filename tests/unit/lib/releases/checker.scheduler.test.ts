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
  getLatestReleasesForRepos: async () => [
    {
      repoId: "github:owner/repo",
      repoUrl: "https://github.com/owner/repo",
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
    },
  ],
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
    sendNotificationMock.mockReset();
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
});

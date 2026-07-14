// vitest globals enabled

import type { Repository } from "@/types";
import { installFetchMock, mockFetchResponse } from "../helpers/fetch";

// Mocks
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

// In-memory repository store mock
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

// Mock notifications to capture/send/throw
const sendNotificationMock = vi.fn();
vi.mock("@/lib/notifications", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    getConfiguredNotificationChannels: () => ["apprise"],
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  };
});

describe("deduplication in checkForNewReleases", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    sendNotificationMock.mockReset();
  });

  it("first fetch sets lastSeenReleaseTag without notifying", async () => {
    // Mock fetch to return a single release
    const nowIso = new Date().toISOString();
    installFetchMock().mockResolvedValue(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1",
            name: "v1",
            body: "x",
            created_at: nowIso,
            published_at: nowIso,
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    const actions = await import("@/app/actions");
    mem.repos = [{ id: "o/r", url: "https://github.com/o/r" }];

    const res = await actions.checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(0);
    expect(mem.repos[0]?.lastSeenReleaseTag).toBe("v1");
  });

  it("keeps a failed notification pending while advancing the release tag", async () => {
    const nowIso = new Date().toISOString();
    installFetchMock().mockResolvedValue(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 2,
            html_url: "#",
            tag_name: "v2",
            name: "v2",
            body: "x",
            created_at: nowIso,
            published_at: nowIso,
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    const actions = await import("@/app/actions");
    sendNotificationMock.mockRejectedValueOnce(new Error("fail"));

    mem.repos = [
      { id: "o/r", url: "https://github.com/o/r", lastSeenReleaseTag: "v1" },
    ];

    const res = await actions.checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(0);
    expect(mem.repos[0]?.lastSeenReleaseTag).toBe("v2");
    expect(mem.repos[0]?.pendingNotifications).toHaveLength(1);
    expect(mem.repos[0]?.pendingNotifications?.[0]?.attempts).toBe(1);
  });

  it("retries and removes a previously failed notification", async () => {
    const nowIso = new Date().toISOString();
    installFetchMock().mockResolvedValue(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 2,
            html_url: "#",
            tag_name: "v2",
            name: "v2",
            body: "x",
            created_at: nowIso,
            published_at: nowIso,
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    const actions = await import("@/app/actions");
    sendNotificationMock.mockResolvedValue(undefined);
    mem.repos = [
      {
        id: "o/r",
        url: "https://github.com/o/r",
        lastSeenReleaseTag: "v2",
        pendingNotifications: [
          {
            id: "o%2Fr:v2",
            repository: { id: "o/r", url: "https://github.com/o/r" },
            release: {
              id: 2,
              html_url: "#",
              tag_name: "v2",
              name: "v2",
              body: "x",
              created_at: nowIso,
              published_at: nowIso,
              prerelease: false,
              draft: false,
            },
            locale: "en",
            settings: { timeFormat: "24h" },
            channels: ["apprise"],
            createdAt: nowIso,
            attempts: 1,
            nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
          },
        ],
      },
    ];

    const res = await actions.checkForNewReleases({ skipCache: true });

    expect(res.notificationsSent).toBe(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(mem.repos[0]?.pendingNotifications).toBeUndefined();
  });
});

// vitest globals enabled

import type { Repository } from "@/types";
import { installFetchMock, mockFetchResponse } from "../helpers/fetch";

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
    showAcknowledge: false, // key for this test
  }),
}));

const sendNotificationMock = vi.fn();
vi.mock("@/lib/notifications", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    getConfiguredNotificationChannels: () => ["apprise"],
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  };
});

describe("checkForNewReleases with showAcknowledge=false", () => {
  const fetchBackup = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    installFetchMock();
    mem.repos = [];
    sendNotificationMock.mockReset();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("updates lastSeen and keeps isNew=false on new release", async () => {
    // Existing repo with previously seen tag v1
    mem.repos = [
      { id: "o/r", url: "https://github.com/o/r", lastSeenReleaseTag: "v1" },
    ];

    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 2,
            html_url: "#",
            tag_name: "v2",
            name: "v2",
            body: "x",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    const { checkForNewReleases } = await import("@/app/actions");
    const res = await checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(1);
    const [repo] = mem.repos;
    expect(repo?.lastSeenReleaseTag).toBe("v2");
    expect(repo?.isNew).toBe(false); // no highlight when showAcknowledge=false
  });
});

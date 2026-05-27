// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import type { AppSettings, GithubRelease, Repository } from "@/types";

describe("sendNotification with no services configured", () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    // @ts-expect-error
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...envBackup };
    global.fetch = fetchBackup;
  });

  it("logs a warning and resolves without sending", async () => {
    delete process.env.MAIL_HOST;
    delete process.env.APPRISE_URL;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendNotification } = await import("@/lib/notifications");

    const repo: Repository = { id: "o/r", url: "https://github.com/o/r" };
    const release: GithubRelease = {
      id: 1,
      html_url: "#",
      tag_name: "v1",
      name: "v1",
      body: "x",
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      prerelease: false,
      draft: false,
    };
    await expect(
      sendNotification(repo, release, "en", {
        timeFormat: "24h",
        locale: "en",
        refreshInterval: 10,
        cacheInterval: 5,
        releasesPerPage: 30,
        parallelRepoFetches: 5,
        releaseChannels: ["stable"],
      } satisfies AppSettings),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    // Ensure no HTTP call attempted
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(0);
    warnSpy.mockRestore();
  });
});

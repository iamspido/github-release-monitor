// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
}));

import type { AppSettings, GithubRelease, Repository } from "@/types";

// Mock html body generator to a known value
vi.mock("@/lib/notifications/email", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    generateHtmlReleaseBody: async () => "<html>hello</html>",
  };
});

describe("notifications/html format route", () => {
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

  it("uses HTML generator and does not truncate", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    const { sendNotification } = await import("@/lib/notifications");

    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      appriseFormat: "html",
    };
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
    // appriseMaxCharacters small should not affect html format
    const settings: AppSettings = {
      timeFormat: "24h",
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 5,
      releaseChannels: ["stable"],
      appriseMaxCharacters: 1,
    };

    await sendNotification(repo, release, "en", settings);
    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.format).toBe("html");
    expect(payload.body).toBe("<html>hello</html>");
  });
});

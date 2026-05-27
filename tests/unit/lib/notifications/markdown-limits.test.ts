// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
}));

import type { AppSettings, GithubRelease, Repository } from "@/types";

describe("notifications/markdown limits", () => {
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

  const repo: Repository = {
    id: "owner/repo",
    url: "https://github.com/owner/repo",
  };
  const release: GithubRelease = {
    id: 1,
    html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
    tag_name: "v1.0.0",
    name: "v1",
    body: "release notes",
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  it("when availableLength <= 0, body becomes view_on_github_link", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    const { sendNotification } = await import("@/lib/notifications");

    const settings = {
      ...({} as AppSettings),
      timeFormat: "24h",
      appriseMaxCharacters: 1,
    }; // forces availableLength <= 0
    const repoOverrides: Repository = { ...repo, appriseFormat: "markdown" };
    await sendNotification(repoOverrides, release, "en", settings);

    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.body).toBe("view_on_github_link");
  });

  it("when body shorter than limit, appends footer and link", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    const { sendNotification } = await import("@/lib/notifications");

    const settings = {
      ...({} as AppSettings),
      timeFormat: "24h",
      appriseMaxCharacters: 10000,
    }; // large limit
    const repoOverrides: Repository = { ...repo, appriseFormat: "markdown" };
    await sendNotification(repoOverrides, release, "en", settings);

    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.body).toContain("view_on_github_link");
    expect(payload.body).toContain("---"); // footer separator present
  });
});

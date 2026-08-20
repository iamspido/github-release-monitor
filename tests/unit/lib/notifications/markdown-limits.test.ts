// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
}));

import type { AppSettings, GithubRelease, Repository } from "@/types";
import {
  fetchCallBodyText,
  installFetchMock,
  mockFetchResponse,
} from "../../helpers/fetch";

describe("notifications/markdown limits", () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;

  beforeEach(() => {
    installFetchMock();
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
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

  it("when no priority link fits, body still respects the limit", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    const { sendNotification } = await import("@/lib/notifications");

    const settings: AppSettings = {
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 5,
      releaseChannels: ["stable"],
      timeFormat: "24h",
      appriseMaxCharacters: 1,
    }; // forces every complete priority link to exceed the limit
    const repoOverrides: Repository = { ...repo, appriseFormat: "markdown" };
    await sendNotification(repoOverrides, release, "en", settings);

    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(fetchCallBodyText(call));
    expect(payload.body.length).toBeLessThanOrEqual(1);
  });

  it("when body is shorter than the limit, appends the footer links", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    const { sendNotification } = await import("@/lib/notifications");

    const settings: AppSettings = {
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 5,
      releaseChannels: ["stable"],
      timeFormat: "24h",
      appriseMaxCharacters: 10000,
    }; // large limit
    const repoOverrides: Repository = { ...repo, appriseFormat: "markdown" };
    await sendNotification(repoOverrides, release, "en", settings);

    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(fetchCallBodyText(call));
    expect(payload.body).toContain("view_on_github_link");
    expect(payload.body).toContain("view\\_monitor\\_label");
    expect(payload.body).toContain("http://localhost:3000/en");
    expect(payload.body).toContain("---"); // footer separator present
  });
});

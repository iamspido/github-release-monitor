// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
}));

import type { GithubRelease, Repository } from "@/types";
import { installFetchMock, mockFetchResponse } from "../../helpers/fetch";

describe("sendTestAppriseNotification success path", () => {
  const env = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    installFetchMock();
  });
  afterEach(() => {
    process.env = { ...env };
    global.fetch = fetchBackup;
  });

  it("returns when APPRISE_URL set and server responds 200", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({
        status: 200,
        text: "",
      }),
    );
    const { sendTestAppriseNotification } = await import("@/lib/notifications");
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
      sendTestAppriseNotification(repo, release, "en", {
        timeFormat: "24h",
      }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(1);
  });
});

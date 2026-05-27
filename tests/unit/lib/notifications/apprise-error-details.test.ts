import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, GithubRelease, Repository } from "@/types";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string, vars?: Record<string, unknown>) =>
    vars ? `${k}:${vars.status ?? ""}:${vars.details ?? ""}` : k,
}));

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

const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 5,
  releaseChannels: ["stable"],
  appriseFormat: "text",
};

describe("apprise error details", () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    process.env = { ...envBackup };
    // @ts-expect-error partial fetch mock for notification tests
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...envBackup };
    global.fetch = fetchBackup;
  });

  it("throws with status and details when Apprise returns !ok (via sendTestAppriseNotification)", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      text: async () => "bad",
      status: 503,
      headers: new Headers(),
    });
    const { sendTestAppriseNotification } = await import("@/lib/notifications");
    await expect(
      sendTestAppriseNotification(repo, release, "en", baseSettings),
    ).rejects.toThrow(/503|bad/);
  });
});

// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

describe("getLatestReleasesForRepos invalid url path", () => {
  it("marks repo with error invalid_url and preserves its settings snapshot", async () => {
    const { getLatestReleasesForRepos } = await import("@/app/actions");
    const repo: Repository = {
      id: "e/r",
      url: "https://example.com/e/r",
      displayName: "Broken source",
      includeRegex: "^v2",
      refreshInterval: 30,
    };
    const settings: AppSettings = {
      timeFormat: "24h",
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 0,
      releasesPerPage: 30,
      parallelRepoFetches: 5,
      releaseChannels: ["stable"],
    };
    const res = await getLatestReleasesForRepos([repo], settings, "en", {
      skipCache: true,
    });
    expect(res[0].error?.type).toBe("invalid_url");
    expect(res[0].repoSettings).toMatchObject({
      displayName: "Broken source",
      includeRegex: "^v2",
      refreshInterval: 30,
    });
  });
});

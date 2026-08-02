// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

describe("getLatestReleasesForRepos invalid url path", () => {
  afterEach(() => {
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
  });

  it("marks repo with error invalid_url and preserves its settings snapshot", async () => {
    const { getLatestReleasesForRepos } = await import("@/app/actions");
    const repo: Repository = {
      id: "e/r",
      url: "https://example.test/e/r",
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

  it("does not contact a removed Forgejo instance", async () => {
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    const fetchSpy = vi.spyOn(global, "fetch");
    const { getLatestReleasesForRepos } = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:scm.example.test/code/owner/repo",
      url: "https://scm.example.test/code/owner/repo",
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

    const [result] = await getLatestReleasesForRepos([repo], settings, "en", {
      skipCache: true,
    });

    expect(result.error?.type).toBe("invalid_url");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not reinterpret a removed Forgejo subpath as a parent instance", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS = "https://scm.example.test";
    const fetchSpy = vi.spyOn(global, "fetch");
    const { getLatestReleasesForRepos } = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:scm.example.test/code/owner/repo",
      url: "https://scm.example.test/code/owner/repo",
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

    const [result] = await getLatestReleasesForRepos([repo], settings, "en", {
      skipCache: true,
    });

    expect(result.error?.type).toBe("invalid_url");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not reinterpret a removed Forgejo repository as another provider", async () => {
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    process.env.GITLAB_ADDITIONAL_HOSTS = "scm.example.test";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("unexpected outbound request"));
    const { getLatestReleasesForRepos } = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:scm.example.test/code/owner/repo",
      url: "https://scm.example.test/code/owner/repo",
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

    const [result] = await getLatestReleasesForRepos([repo], settings, "en", {
      skipCache: true,
    });

    expect(result.error?.type).toBe("invalid_url");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

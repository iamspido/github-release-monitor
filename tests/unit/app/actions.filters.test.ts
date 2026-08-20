// vitest globals enabled

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { getLatestReleasesForRepos } from "@/app/actions";
import type { AppSettings, Repository } from "@/types";
import { installFetchMock, mockFetchResponse } from "../helpers/fetch";

describe("filters: include/exclude/channels/subchannels", () => {
  const fetchBackup = global.fetch;
  const baseSettings: AppSettings = {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    parallelRepoFetches: 5,
    releaseChannels: ["stable", "prerelease", "draft"],
    preReleaseSubChannels: ["beta", "rc"],
  };

  beforeEach(() => {
    installFetchMock();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("exclude regex takes precedence over include", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      includeRegex: "v",
      excludeRegex: "v2",
    };

    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
          {
            id: 2,
            html_url: "#",
            tag_name: "v2",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].release?.tag_name).toBe("v1");
  });

  it("invalid regex is ignored (no throw)", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      includeRegex: "([",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].release?.tag_name).toBe("v1");
  });

  it("prerelease by tag name matches only configured subchannels", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["prerelease"],
    };
    // two prerelease-like tags by name
    const now = Date.now();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1.0.0-beta",
            name: null,
            body: "Release notes",
            created_at: new Date(now - 2000).toISOString(),
            published_at: new Date(now - 2000).toISOString(),
            prerelease: false,
            draft: false,
          },
          {
            id: 2,
            html_url: "#",
            tag_name: "v1.0.0-alpha",
            name: null,
            body: "Release notes",
            created_at: new Date(now - 1000).toISOString(),
            published_at: new Date(now - 1000).toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    // Settings allow only beta/rc
    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].release?.tag_name).toBe("v1.0.0-beta");
  });

  it("prerelease API flag does not require pre-release keyword in tag", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["prerelease"],
    };

    // Tag name does not include beta/rc, but prerelease flag is true.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1.0.0-1",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: true,
            draft: false,
          },
        ],
      }),
    );

    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].release?.tag_name).toBe("v1.0.0-1");
  });

  it("an empty preReleaseSubChannels list disables built-in tag detection", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["prerelease"],
    };

    // Tag includes a prerelease marker; global preReleaseSubChannels is empty.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1.0.0-rc1",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );

    const settingsWithEmptySubs: AppSettings = {
      ...baseSettings,
      preReleaseSubChannels: [],
    };

    const enriched = await getLatestReleasesForRepos(
      [repo],
      settingsWithEmptySubs,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("no_matching_releases");
  });

  it("draft releases included only when channel allows", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["draft"],
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: true,
          },
        ],
      }),
    );
    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].release?.tag_name).toBe("v1");
  });

  it("does not match words containing pre-release keyword", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["prerelease"],
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "v1-betamax",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("no_matching_releases");
  });

  it("treats rc suffix without separators as prerelease", async () => {
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseChannels: ["stable"],
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: [
          {
            id: 1,
            html_url: "#",
            tag_name: "release_candidate_1.0rc2",
            name: null,
            body: "Release notes",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    const enriched = await getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("no_matching_releases");
  });
});

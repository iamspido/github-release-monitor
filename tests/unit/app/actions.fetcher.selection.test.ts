// vitest globals enabled

// Mocks for next/cache to bypass Next runtime
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

// Mock next-intl translations used in tag fallback
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import type { AppSettings, Repository } from "@/types";
import {
  fetchCallHeaders,
  headerRecord,
  installFetchMock,
  mockFetchResponse,
} from "../helpers/fetch";

describe("actions fetcher scenarios", () => {
  const fetchBackup = global.fetch;
  const baseSettings: AppSettings = {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    parallelRepoFetches: 5,
    releaseChannels: ["stable"],
  };

  beforeEach(() => {
    vi.resetModules();
    installFetchMock();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("clears the ETag when the response has no matching release", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      etag: 'W/"old"',
      latestRelease: {
        html_url: "https://github.com/o/r/releases/tag/v1.0.0",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "body",
        commit_links: [],
        created_at: "2024-01-01T00:00:00Z",
        published_at: "2024-01-01T00:00:00Z",
      },
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        headers: { etag: 'W/"prerelease-only"' },
        json: [
          {
            id: 2,
            html_url: "https://github.com/o/r/releases/tag/v2.0.0-beta.1",
            tag_name: "v2.0.0-beta.1",
            name: "v2.0.0-beta.1",
            body: "body",
            created_at: "2024-02-01T00:00:00Z",
            published_at: "2024-02-01T00:00:00Z",
            prerelease: true,
            draft: false,
          },
        ],
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("no_matching_releases");
    expect(enriched[0].newEtag).toBeNull();
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBe('W/"old"');
  });

  it("selects Coturn's Docker revision with a repository version tag pattern", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "coturn/coturn",
      url: "https://github.com/coturn/coturn",
      releaseSelectionStrategy: "highest_version",
      versionTagPattern:
        "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 1,
            html_url: "https://github.com/coturn/coturn/releases/tag/4.15.0",
            tag_name: "4.15.0",
            name: "4.15.0",
            body: "source release",
            created_at: "2026-07-01T00:00:00Z",
            published_at: "2026-07-01T00:00:00Z",
            prerelease: false,
            draft: false,
          },
          {
            id: 2,
            html_url:
              "https://github.com/coturn/coturn/releases/tag/docker/4.15.0-r0",
            tag_name: "docker/4.15.0-r0",
            name: "docker/4.15.0-r0",
            body: "docker release",
            created_at: "2026-06-01T00:00:00Z",
            published_at: "2026-06-01T00:00:00Z",
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("docker/4.15.0-r0");
    expect(enriched[0].error).toBeUndefined();
  });

  it("keeps a production-suffixed formal release ahead of its base tag", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
    };
    const selectedSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        headers: { etag: 'W/"formal-releases"' },
        json: [
          {
            id: 1,
            html_url: "https://github.com/owner/repo/releases/tag/v1.0.0-fix",
            tag_name: "v1.0.0-fix",
            name: "v1.0.0",
            body: "fixed invalid GUID",
            created_at: "2026-01-01T00:00:00Z",
            published_at: "2026-01-01T00:00:00Z",
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/owner/repo/releases/tag/v1.0.0">v1.0.0</a>
          <relative-time datetime="2025-12-01T00:00:00Z">Dec 1</relative-time>
          <a href="/owner/repo/commit/${selectedSha}">aaaaaaa</a>
        `,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          { name: "v1.0.0-fix", commit: { sha: "bbbb" } },
          { name: "v1.0.0", commit: { sha: selectedSha } },
        ],
      }),
    );
    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.0.0-fix");
    expect(enriched[0].release?.id).toBe(1);
    expect(enriched[0].newEtag).toBeNull();
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
  });

  it("selects and enriches a higher standalone tag over a formal release", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
    };
    const selectedSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 1,
            html_url: "https://github.com/owner/repo/releases/tag/v1.0.0-fix",
            tag_name: "v1.0.0-fix",
            name: "v1.0.0-fix",
            body: "production fix",
            created_at: "2026-01-02T00:00:00Z",
            published_at: "2026-01-02T00:00:00Z",
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/owner/repo/releases/tag/v1.1.0">v1.1.0</a>
          <relative-time datetime="2026-01-01T00:00:00Z">Jan 1</relative-time>
          <a href="/owner/repo/commit/${selectedSha}">aaaaaaa</a>
        `,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          { name: "v1.1.0", commit: { sha: selectedSha } },
          { name: "v1.0.0-fix", commit: { sha: "bbbb" } },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: { object: { type: "commit", sha: selectedSha, url: "unused" } },
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: {
          commit: {
            message: "Standalone v1.1.0",
            committer: { date: "2026-01-01T00:00:00Z" },
          },
        },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toEqual(
      expect.objectContaining({
        id: 0,
        tag_name: "v1.1.0",
        created_at: "2026-01-01T00:00:00Z",
        published_at: "2026-01-01T00:00:00Z",
        published_at_unknown: false,
      }),
    );
    expect(enriched[0].release?.body).toContain("Standalone v1.1.0");
    expect(enriched[0].newEtag).toBeNull();
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(5);
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/git/ref/tags/v1.1.0",
    );
    expect(vi.mocked(global.fetch).mock.calls[4][0]).toContain(
      `/commits/${selectedSha}`,
    );
  });

  it("reports when no release matches a configured version tag pattern", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "coturn/coturn",
      url: "https://github.com/coturn/coturn",
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^docker/(?<version>\\d+\\.\\d+\\.\\d+)$",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 1,
            html_url: "https://github.com/coturn/coturn/releases/tag/4.15.0",
            tag_name: "4.15.0",
            name: "4.15.0",
            body: "source release",
            created_at: "2026-07-01T00:00:00Z",
            published_at: "2026-07-01T00:00:00Z",
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("no_matching_version_tags");
  });

  it("does not use a page-one ETag for highest-version selection", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 101,
      etag: 'W/"page-one"',
      latestRelease: {
        html_url: "https://github.com/o/r/releases/tag/v1.0.0",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "body",
        created_at: "2024-01-01T00:00:00Z",
        published_at: "2024-01-01T00:00:00Z",
      },
    };

    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      html_url: `https://github.com/o/r/releases/tag/v${index + 1}.0.0`,
      tag_name: `v${index + 1}.0.0`,
      name: `v${index + 1}.0.0`,
      body: "body",
      created_at: "2024-02-01T00:00:00Z",
      published_at: "2024-02-01T00:00:00Z",
      prerelease: false,
      draft: false,
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: firstPage }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 999,
            html_url: "https://github.com/o/r/releases/tag/v999.0.0",
            tag_name: "v999.0.0",
            name: "v999.0.0",
            body: "body",
            created_at: "2024-02-01T00:00:00Z",
            published_at: "2024-02-01T00:00:00Z",
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v999.0.0");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(4);
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBeUndefined();
  });

  it("does not use a stale releases ETag when no cached release exists", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "github:zammad/zammad",
      url: "https://github.com/zammad/zammad",
      etag: '"stale-empty-releases"',
    };

    const nowIso = new Date().toISOString();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        headers: { etag: '"empty-releases"' },
        json: [],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [{ name: "6.5.1", commit: { sha: "sha1" } }],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: { object: { type: "commit", url: "unused" } },
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: {
          commit: { message: "msg", committer: { date: nowIso } },
        },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const releasesRequest = vi.mocked(global.fetch).mock.calls[0];

    expect(
      headerRecord(fetchCallHeaders(releasesRequest))["If-None-Match"],
    ).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("6.5.1");
    expect(enriched[0].newEtag).toBeNull();
  });

  it("paginates over multiple pages", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releasesPerPage: 150,
    };

    const now = Date.now();
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      html_url: "#",
      tag_name: `v${i + 1}`,
      name: null,
      body: "x",
      created_at: new Date(now - (200 - i) * 1000).toISOString(),
      published_at: new Date(now - (200 - i) * 1000).toISOString(),
      prerelease: false,
      draft: false,
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: 100 + i + 1,
      html_url: "#",
      tag_name: `v${100 + i + 1}`,
      name: null,
      body: "x",
      created_at: new Date(now - (50 - i) * 1000).toISOString(),
      published_at: new Date(now - (50 - i) * 1000).toISOString(),
      prerelease: false,
      draft: false,
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: page1,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: page2,
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      { ...baseSettings, releasesPerPage: 30 },
      "en",
      { skipCache: true },
    );
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(2);
    expect(enriched[0].release?.tag_name).toBe("v150");
  });

  it("uses GitHub's provider-latest endpoint when configured", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseSelectionStrategy: "provider_latest",
    };
    const newestByPublication = {
      id: 2,
      html_url: "https://github.com/o/r/releases/tag/v2.0.0",
      tag_name: "v2.0.0",
      name: "v2.0.0",
      body: "newer publication",
      created_at: "2024-04-01T00:00:00Z",
      published_at: "2024-04-01T00:00:00Z",
      prerelease: false,
      draft: false,
    };
    const providerLatest = {
      ...newestByPublication,
      id: 1,
      tag_name: "v1.5.0",
      html_url: "https://github.com/o/r/releases/tag/v1.5.0",
      created_at: "2024-01-01T00:00:00Z",
      published_at: "2024-01-01T00:00:00Z",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: providerLatest }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.5.0");
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://api.github.com/repos/o/r/releases/latest",
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("trusts GitHub's provider-latest designation over tag markers", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseSelectionStrategy: "provider_latest",
    };
    const providerLatest = {
      id: 1,
      html_url: "https://github.com/o/r/releases/tag/v1.5.0-beta.1",
      tag_name: "v1.5.0-beta.1",
      name: "v1.5.0-beta.1",
      body: "provider-designated latest",
      created_at: "2024-01-01T00:00:00Z",
      published_at: "2024-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: providerLatest }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.5.0-beta.1");
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("preserves provider-latest endpoint errors", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseSelectionStrategy: "provider_latest",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 429,
        statusText: "Too Many Requests",
        text: "rate limited",
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("rate_limit");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });
});

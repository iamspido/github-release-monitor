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

  it("handles 304 not_modified and reconstructs from cache", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      etag: 'W/"abc"',
      latestRelease: {
        html_url: "https://github.com/o/r/releases/tag/v1",
        tag_name: "v1",
        name: "v1",
        body: "body",
        created_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 304,
        headers: { etag: 'W/"def"' },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("not_modified");
    expect(enriched[0].release?.id).toBe(0); // reconstructed
    expect(enriched[0].release?.tag_name).toBe("v1");
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

  it("checks only one releases page when provider-latest is absent", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      releaseSelectionStrategy: "provider_latest",
      releasesPerPage: 150,
    };
    const releases = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      html_url: `https://github.com/o/r/releases/tag/v${index + 1}`,
      tag_name: `v${index + 1}`,
      name: `v${index + 1}`,
      body: "body",
      created_at: "2024-01-01T00:00:00Z",
      published_at: "2024-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: releases }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error?.type).toBe("no_matching_releases");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toContain(
      "/releases?per_page=100&page=1",
    );
  });

  it("falls back to tags when no releases", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [{ name: "release/1.0.0", commit: { sha: "sha1" } }],
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
          commit: {
            message: "msg",
            committer: { date: new Date().toISOString() },
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
    expect(enriched[0].release?.id).toBe(0);
    expect(enriched[0].release?.tag_name).toBe("release/1.0.0");
    expect(enriched[0].release?.html_url).toBe(
      "https://github.com/o/r/releases/tag/release%2F1.0.0",
    );
    expect(enriched[0].release?.published_at_unknown).toBe(false);
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/git/ref/tags/release%2F1.0.0",
    );
  });

  it("preserves an unknown date when annotated tag metadata has no date", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            name: "v1.0.0",
            commit: {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
        ],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: {
          object: {
            type: "tag",
            sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            url: "https://api.github.test/tags/1",
          },
        },
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: { message: "Annotated release notes" },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.0.0");
    expect(enriched[0].release?.published_at_unknown).toBe(true);
    expect(enriched[0].release?.body).toContain("Annotated release notes");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(5);
  });

  it("uses GitHub's chronological tags page before its REST tags order", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "github:golang/go",
      url: "https://github.com/golang/go",
    };
    const selectedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/golang/go/releases/tag/go1.27rc2">go1.27rc2</a>
          <relative-time datetime="2026-07-07T19:42:34Z">Jul 7</relative-time>
          <a href="/golang/go/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">aaaaaaa</a>
          <a href="/golang/go/releases/tag/go1.26.5">go1.26.5</a>
          <relative-time datetime="2026-07-07T19:29:04Z">Jul 7</relative-time>
          <a href="/golang/go/commit/${selectedSha}">bbbbbbb</a>
          <a href="/golang/go/releases/tag/weekly.2012-03-27">weekly.2012-03-27</a>
          <relative-time datetime="2012-03-27T00:00:00Z">Mar 27</relative-time>
          <a href="/golang/go/commit/cccccccccccccccccccccccccccccccccccccccc">ccccccc</a>
        `,
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
            message: "go1.26.5",
            committer: { date: "2026-07-07T19:29:04Z" },
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
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(enriched[0].release?.tag_name).toBe("go1.26.5");
    expect(enriched[0].release?.created_at).toBe("2026-07-07T19:29:04Z");
    expect(calls[1][0]).toBe("https://github.com/golang/go/tags");
    expect(
      headerRecord(fetchCallHeaders(calls[1])).Authorization,
    ).toBeUndefined();
    expect(calls[3][0]).toContain(`/commits/${selectedSha}`);
    expect(calls.some(([url]) => String(url).includes("/tags?"))).toBe(false);
  });

  it("selects the highest stable Go version instead of a weekly tag", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "github:golang/go",
      url: "https://github.com/golang/go",
      releaseSelectionStrategy: "highest_version",
    };
    const selectedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/golang/go/releases/tag/go1.27rc2">go1.27rc2</a>
          <relative-time datetime="2026-07-07T19:42:34Z">Jul 7</relative-time>
          <a href="/golang/go/commit/cccccccccccccccccccccccccccccccccccccccc">ccccccc</a>
          <a href="/golang/go/releases/tag/go1.26.5">go1.26.5</a>
          <relative-time datetime="2026-07-07T19:29:04Z">Jul 7</relative-time>
          <a href="/golang/go/commit/${selectedSha}">bbbbbbb</a>
          <a href="/golang/go/releases/tag/go1.25.12">go1.25.12</a>
          <relative-time datetime="2026-07-07T19:20:04Z">Jul 7</relative-time>
          <a href="/golang/go/commit/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee">eeeeeee</a>
        `,
      }),
    );
    // GitHub's REST endpoint is lexicographic for this repository, so its
    // first page contains only old weekly tags.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            name: "weekly.2012-03-27",
            commit: {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
          {
            name: "weekly.2012-03-22",
            commit: {
              sha: "dddddddddddddddddddddddddddddddddddddddd",
            },
          },
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
            message: "go1.26.5",
            committer: { date: "2026-07-07T19:29:04Z" },
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

    expect(enriched[0].release?.tag_name).toBe("go1.26.5");
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe(
      "https://github.com/golang/go/tags",
    );
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toContain("/tags?");
    expect(vi.mocked(global.fetch).mock.calls[4][0]).toContain(
      `/commits/${selectedSha}`,
    );
  });

  it("uses chronological GitHub tag candidates when the REST tag request fails", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 1,
    };
    const selectedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/owner/repo/releases/tag/release-v2">release-v2</a>
          <relative-time datetime="2026-07-07T19:29:04Z">Jul 7</relative-time>
          <a href="/owner/repo/commit/${selectedSha}">bbbbbbb</a>
        `,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 500, statusText: "Internal Server Error" }),
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
            message: "release-v2",
            committer: { date: "2026-07-07T19:29:04Z" },
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

    expect(enriched[0].release?.tag_name).toBe("release-v2");
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toContain("/tags?");
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/git/ref/tags/release-v2",
    );
  });

  it("returns an error when a paginated GitHub tag scan remains incomplete", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 150,
    };
    const firstPageTags = Array.from({ length: 100 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      commit: {
        sha: String(index + 1).padStart(40, "0"),
      },
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: firstPageTags }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 500, statusText: "Internal Server Error" }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("api_error");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toContain(
      "/tags?per_page=100&page=1",
    );
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/tags?per_page=50&page=2",
    );
  });

  it("does not present unordered undated tags as the highest version", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            name: "weekly.2012-03-27",
            commit: {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
          {
            name: "nightly-main",
            commit: {
              sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
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
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
  });

  it("keeps merged GitHub tag candidates within the configured limit", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 1,
    };
    const selectedSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        text: `
          <a href="/owner/repo/releases/tag/current-build">current-build</a>
          <relative-time datetime="2026-07-07T19:42:34Z">Jul 7</relative-time>
          <a href="/owner/repo/commit/${selectedSha}">aaaaaaa</a>
        `,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            name: "legacy-99.0.0",
            commit: {
              sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
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
            message: "current build",
            committer: { date: "2026-07-07T19:42:34Z" },
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

    expect(enriched[0].release?.tag_name).toBe("current-build");
    expect(enriched[0].error).toBeUndefined();
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toContain(
      "/tags?per_page=1&page=1",
    );
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/git/ref/tags/current-build",
    );
  });

  it("selects the highest version across paginated GitHub tag fallbacks", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 150,
    };
    const selectedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const firstPageTags = Array.from({ length: 100 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      commit: {
        sha: String(index + 1).padStart(40, "0"),
      },
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: firstPageTags,
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [{ name: "v999.0.0", commit: { sha: selectedSha } }],
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
            message: "v999.0.0",
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

    expect(enriched[0].release?.tag_name).toBe("v999.0.0");
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe(
      "https://github.com/owner/repo/tags",
    );
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toContain(
      "/tags?per_page=100&page=1",
    );
    expect(vi.mocked(global.fetch).mock.calls[3][0]).toContain(
      "/tags?per_page=50&page=2",
    );
    expect(vi.mocked(global.fetch).mock.calls[5][0]).toContain(
      `/commits/${selectedSha}`,
    );
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(
          ([url]) => String(url) === "https://github.com/owner/repo/tags",
        ),
    ).toBe(true);
  });

  it("falls back to the first matching stable tag when newer tags are prereleases", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "github:zammad/zammad",
      url: "https://github.com/zammad/zammad",
    };
    const nowIso = new Date().toISOString();

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 404 }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          { name: "7.2.0-alpha", commit: { sha: "sha-alpha-2" } },
          { name: "7.1.0-alpha", commit: { sha: "sha-alpha-1" } },
          { name: "7.0.1", commit: { sha: "sha-stable" } },
        ],
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
          commit: { message: "stable msg", committer: { date: nowIso } },
        },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("7.0.1");
    expect(vi.mocked(global.fetch).mock.calls[4][0]).toContain(
      "/commits/sha-stable",
    );
  });

  it("maps rate_limit and repo_not_found errors", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
    };

    const rateLimitResponse = mockFetchResponse({
      status: 403,
      statusText: "Forbidden",
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
      text: "rate limited",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(rateLimitResponse);
    let enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("rate_limit");
    expect(rateLimitResponse.bodyUsed).toBe(true);

    const notFoundResponse = mockFetchResponse({
      status: 404,
      statusText: "Not Found",
      text: "missing",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(notFoundResponse);
    enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("repo_not_found");
    expect(notFoundResponse.bodyUsed).toBe(true);
  });

  it("preserves repository order when parallel batches resolve out of order", async () => {
    const actions = await import("@/app/actions");
    const originalFetch = global.fetch;

    const repos: Repository[] = [
      {
        id: "alpha/repo-a",
        url: "https://github.com/alpha/repo-a",
        releaseChannels: ["stable", "prerelease"],
      },
      {
        id: "beta/repo-b",
        url: "https://github.com/beta/repo-b",
        releaseChannels: ["stable", "prerelease"],
      },
      {
        id: "gamma/repo-c",
        url: "https://github.com/gamma/repo-c",
        releaseChannels: ["stable", "prerelease"],
      },
    ];

    const releaseMap: Record<string, unknown[]> = {
      "alpha/repo-a": [
        {
          id: 1,
          html_url: "#a",
          tag_name: "v1-a",
          name: "A",
          body: "note-a",
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          prerelease: false,
          draft: false,
        },
      ],
      "beta/repo-b": [
        {
          id: 2,
          html_url: "#b",
          tag_name: "v1-b",
          name: "B",
          body: "note-b",
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          prerelease: false,
          draft: false,
        },
      ],
      "gamma/repo-c": [
        {
          id: 3,
          html_url: "#c",
          tag_name: "v1-c",
          name: "C",
          body: "note-c",
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          prerelease: false,
          draft: false,
        },
      ],
    };

    const delays: Record<string, number> = {
      "alpha/repo-a": 30,
      "beta/repo-b": 10,
      "gamma/repo-c": 0,
    };

    global.fetch = vi.fn<typeof fetch>((input): Promise<Response> => {
      const url = String(input);
      const match = url.match(/repos\/([^/]+\/[^/]+)\/releases/);
      if (!match) {
        return Promise.resolve(mockFetchResponse({ json: [] }));
      }
      const repoId = match[1];
      const data = releaseMap[repoId];
      const delay = delays[repoId] ?? 0;
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(mockFetchResponse({ json: data }));
        }, delay);
      });
    });

    const settings = {
      ...baseSettings,
      parallelRepoFetches: 2,
    };

    try {
      const enriched = await actions.getLatestReleasesForRepos(
        repos,
        settings,
        "en",
        { skipCache: true },
      );
      expect(enriched.map((r) => r.repoId)).toEqual([
        "alpha/repo-a",
        "beta/repo-b",
        "gamma/repo-c",
      ]);
      expect(enriched.map((r) => r.release?.tag_name)).toEqual([
        "v1-a",
        "v1-b",
        "v1-c",
      ]);
      expect(vi.mocked(global.fetch).mock.calls.length).toBe(3);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

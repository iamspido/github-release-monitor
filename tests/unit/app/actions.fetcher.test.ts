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
        json: [{ name: "v1", commit: { sha: "sha1" } }],
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
    expect(enriched[0].release?.tag_name).toBe("v1");
    expect(enriched[0].error).toBeUndefined();
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

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 403,
        statusText: "Forbidden",
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
      }),
    );
    let enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("rate_limit");

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
      }),
    );
    enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("repo_not_found");
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

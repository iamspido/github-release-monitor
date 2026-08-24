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
import { installFetchMock, mockFetchResponse } from "../helpers/fetch";

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

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
  fetchCallBodyText,
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

  it("uses the canonical repository for commit links from a renamed tag fallback", async () => {
    const actions = await import("@/app/actions");
    const fullSha = "abcdef0123456789abcdef0123456789abcdef01";
    const repo: Repository = {
      id: "old-owner/old-repo",
      url: "https://github.com/old-owner/old-repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ json: [] }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 404 }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [{ name: "v1.0.0", commit: { sha: fullSha } }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: {
            object: {
              type: "commit",
              sha: fullSha,
              url: `https://api.github.com/repos/new-owner/new-repo/git/commits/${fullSha}`,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: {
            html_url: `https://github.com/new-owner/new-repo/commit/${fullSha}`,
            commit: {
              message: "Fix abcdef0",
              committer: { date: "2026-01-01T00:00:00Z" },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          text: `<a href="/new-owner/new-repo/commit/${fullSha}"><tt>abcdef0</tt></a>`,
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.html_url).toBe(
      "https://github.com/new-owner/new-repo/releases/tag/v1.0.0",
    );
    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: "abcdef0",
        sha: fullSha,
        url: `https://github.com/new-owner/new-repo/commit/${fullSha}`,
      },
    ]);
    expect(
      JSON.parse(fetchCallBodyText(vi.mocked(global.fetch).mock.calls[5]))
        .context,
    ).toBe("new-owner/new-repo");
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
});

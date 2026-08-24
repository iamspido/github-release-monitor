// vitest globals enabled

// Mocks for next/cache to bypass Next runtime
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

// Mock next-intl translations used in tag/commit fallback bodies
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

describe("actions Codeberg fetcher scenarios", () => {
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
    delete process.env.CODEBERG_ACCESS_TOKEN;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("handles 304 not_modified and reconstructs from cache", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
      etag: 'W/"abc"',
      latestRelease: {
        html_url: "https://codeberg.org/o/r/releases/tag/v1",
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

  it("does not use a page-one ETag for highest-version selection", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 51,
      etag: 'W/"page-one"',
      latestRelease: {
        html_url: "https://codeberg.org/o/r/releases/tag/v1.0.0",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "body",
        created_at: "2024-01-01T00:00:00Z",
        published_at: "2024-01-01T00:00:00Z",
      },
    };

    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      html_url: `https://codeberg.org/o/r/releases/tag/v${index + 1}.0.0`,
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
            html_url: "https://codeberg.org/o/r/releases/tag/v999.0.0",
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

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v999.0.0");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBeUndefined();
  });

  it("uses Codeberg's provider-latest endpoint when configured", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
      releaseSelectionStrategy: "provider_latest",
    };
    const release = {
      id: 1,
      html_url: "https://codeberg.org/o/r/releases/tag/v1.0.0",
      tag_name: "v1.0.0",
      name: "v1.0.0",
      body: "body",
      created_at: "2024-01-01T00:00:00Z",
      published_at: "2024-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: release }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.0.0");
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://codeberg.org/api/v1/repos/o/r/releases/latest",
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("resolves release-note commit references through the Forgejo API", async () => {
    const actions = await import("@/app/actions");
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url: "https://codeberg.org/o/r/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "Fix abcdef1",
              created_at: "2026-01-01T00:00:00Z",
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: {
            sha,
            html_url: `https://codeberg.org/o/r/commit/${sha}`,
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.commit_links).toEqual([
      {
        ref: "abcdef1",
        sha,
        url: `https://codeberg.org/o/r/commit/${sha}`,
      },
    ]);
    expect(String(vi.mocked(global.fetch).mock.calls[1][0])).toBe(
      "https://codeberg.org/api/v1/repos/o/r/git/commits/abcdef1?stat=false&verification=false&files=false",
    );
  });

  it("falls back to tags when no releases", async () => {
    const actions = await import("@/app/actions");
    const commitDate = "2020-02-03T04:05:06.000Z";

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
      etag: 'W/"empty-releases"',
      latestRelease: {
        html_url: "https://codeberg.org/o/r/src/tag/v0",
        tag_name: "v0",
        name: "Tag: v0",
        body: "old tag",
        created_at: "2019-01-01T00:00:00Z",
        published_at: "2019-01-01T00:00:00Z",
        source: "tag",
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        headers: { etag: 'W/"still-empty"' },
        json: [],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [{ name: "v1", commit: { sha: "sha1" } }],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: {
          message: "msg",
          author: { date: commitDate },
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
    expect(enriched[0].release?.created_at).toBe(commitDate);
    expect(enriched[0].release?.published_at).toBe(commitDate);
    expect(enriched[0].release?.published_at_unknown).toBe(false);
    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].newEtag).toBeNull();
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBeUndefined();
  });

  it("selects an older matching tag when the newest tag is filtered out", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            { name: "v2.0.0-beta", message: "beta" },
            { name: "v1.9.0", message: "stable" },
          ],
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      { ...baseSettings, releaseChannels: ["stable"] },
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.tag_name).toBe("v1.9.0");
  });

  it("falls back to tags when releases endpoint returns 404 but repo exists", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: { has_releases: false, release_counter: 0 },
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [{ name: "v404", message: "msg", commit: { sha: "sha404" } }],
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: {
          message: "commit-msg",
          author: { date: new Date().toISOString() },
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
    expect(enriched[0].release?.tag_name).toBe("v404");
    expect(enriched[0].error).toBeUndefined();
  });

  it("falls back to tags when commit sha field differs", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [{ name: "v2", commit: { id: "commit-id-2" } }],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: {
          message: "msg2",
          author: { date: new Date().toISOString() },
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
    expect(enriched[0].release?.tag_name).toBe("v2");
    expect(enriched[0].release?.body).toContain("msg2");
    expect(enriched[0].error).toBeUndefined();
  });

  it("rejects partial Codeberg tag results when a later page throws", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 51,
    };
    const firstTagPage = Array.from({ length: 50 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      message: "tag",
    }));

    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        return mockFetchResponse({ status: 200, json: [] });
      }
      if (url.includes("/tags?")) {
        const page = new URL(url).searchParams.get("page");
        if (page === "1") {
          return mockFetchResponse({ status: 200, json: firstTagPage });
        }
        if (page === "2") {
          throw new Error("network failure on page 2");
        }
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("api_error");
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(
          ([input]) => new URL(String(input)).searchParams.get("page") === "2",
        ),
    ).toBe(true);
  });

  it("maps rate_limit error on 429", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    const rateLimitResponse = mockFetchResponse({
      status: 429,
      statusText: "Too Many Requests",
      headers: { "retry-after": "60" },
      text: "slow down",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(rateLimitResponse);

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("rate_limit");
    expect(rateLimitResponse.bodyUsed).toBe(true);
  });

  it("falls back from token to bearer auth on 401", async () => {
    process.env.CODEBERG_ACCESS_TOKEN = "tok";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [
          {
            id: 1,
            tag_name: "v1",
            name: "v1",
            body: "body",
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            prerelease: false,
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

    const firstAuth = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]),
    ).Authorization;
    const secondAuth = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[1]),
    ).Authorization;
    expect(firstAuth).toBe("token tok");
    expect(secondAuth).toBe("Bearer tok");

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1");
  });
});

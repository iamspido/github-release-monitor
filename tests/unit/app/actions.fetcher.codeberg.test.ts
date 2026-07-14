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

  it("falls back to tags when no releases", async () => {
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
        json: [{ name: "v1", commit: { sha: "sha1" } }],
      }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: {
          message: "msg",
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
    expect(enriched[0].release?.tag_name).toBe("v1");
    expect(enriched[0].error).toBeUndefined();
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

  it("maps rate_limit error on 429", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "60" },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    expect(enriched[0].error?.type).toBe("rate_limit");
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

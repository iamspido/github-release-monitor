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
    // @ts-expect-error
    global.fetch = vi.fn();
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

    // 304 on first page
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 304,
      ok: false,
      headers: { get: () => 'W/"def"' },
    });

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

    // releases empty
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [],
    });
    // tags
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [{ name: "v1", commit: { sha: "sha1" } }],
    });
    // commit message (first candidate endpoint `/commits/:sha`)
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({
        message: "msg",
        author: { date: new Date().toISOString() },
      }),
    });

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

  it("falls back to tags when releases endpoint returns 404 but repo exists", async () => {
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "codeberg:o/r",
      url: "https://codeberg.org/o/r",
    };

    // releases endpoint 404 (happens on Codeberg when releases are disabled)
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
    });

    // repo info exists
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({ has_releases: false, release_counter: 0 }),
    });

    // tags
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
        { name: "v404", message: "msg", commit: { sha: "sha404" } },
      ],
    });

    // commit message for tag fallback
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({
        message: "commit-msg",
        author: { date: new Date().toISOString() },
      }),
    });

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

    // releases empty
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [],
    });
    // tags: commit.id instead of commit.sha
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [{ name: "v2", commit: { id: "commit-id-2" } }],
    });
    // commit message (first candidate endpoint `/commits/:sha`)
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({
        message: "msg2",
        author: { date: new Date().toISOString() },
      }),
    });

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

    // rate limit 429
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => "60" },
    });

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

    // token auth attempt -> 401
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: { get: () => null },
    });

    // bearer auth attempt -> 200 with one release
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
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
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    // Ensure the two auth schemes were tried
    // @ts-expect-error
    const firstAuth = vi.mocked(global.fetch).mock.calls[0][1].headers
      .Authorization;
    // @ts-expect-error
    const secondAuth = vi.mocked(global.fetch).mock.calls[1][1].headers
      .Authorization;
    expect(firstAuth).toBe("token tok");
    expect(secondAuth).toBe("Bearer tok");

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1");
  });
});

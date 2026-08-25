import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSettingsForFetch } from "@/lib/releases/types";
import type { AppSettings, GithubRelease } from "@/types";

const fetchMocks = vi.hoisted(() => ({
  fetchJsonResponseWithRetryAuthChain: vi.fn(),
}));

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/releases/fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/releases/fetch")>()),
  ...fetchMocks,
}));

vi.mock("@/lib/server-action-helpers", () => ({
  log: logMock,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { fetchLatestReleaseFromForgejoBase } from "@/lib/releases/forgejo-base";

const globalSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
  preReleaseSubChannels: ["rc"],
};

function createRepoSettings(
  overrides?: Partial<RepoSettingsForFetch>,
): RepoSettingsForFetch {
  return {
    cacheInterval: 10,
    releasesPerPage: 30,
    ...overrides,
  };
}

function forgejoRelease(overrides?: Partial<GithubRelease>): GithubRelease {
  return {
    id: 1,
    html_url: "https://example.forgejo.test/owner/repo/releases/tag/v1.0.0",
    tag_name: "v1.0.0",
    name: "v1.0.0",
    body: "Initial release",
    created_at: "2024-01-01T00:00:00Z",
    published_at: "2024-01-01T00:00:00Z",
    prerelease: false,
    draft: false,
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
  return response;
}

function baseArgs(
  overrides?: Partial<Parameters<typeof fetchLatestReleaseFromForgejoBase>[0]>,
): Parameters<typeof fetchLatestReleaseFromForgejoBase>[0] {
  return {
    baseUrl: "https://example.forgejo.test",
    repoId: "forgejo:owner/repo",
    providerLabel: "Forgejo" as const,
    authToken: null,
    allowedRedirectBaseUrl: null,
    owner: "owner",
    repo: "repo",
    repoSettings: createRepoSettings(),
    globalSettings,
    locale: "en" as const,
    ...overrides,
  };
}

describe("releases/forgejo-base", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    for (const result of fetchMocks.fetchJsonResponseWithRetryAuthChain.mock
      .results) {
      if (result.type !== "return") continue;
      const { response } = (result.value ?? {}) as { response?: Response };
      if (!response) continue;
      try {
        await response.body?.cancel();
      } catch {
        // Mirrors discardResponseWithTimeout: an already consumed or errored
        // body needs no further handling.
      }
    }
  });

  it("returns the latest matching release from a single page", async () => {
    const release = forgejoRelease();
    const response = jsonResponse(200, [release], {
      Etag: '"abc123"',
    });

    fetchMocks.fetchJsonResponseWithRetryAuthChain.mockResolvedValue({
      response,
      data: [release],
    });

    const result = await fetchLatestReleaseFromForgejoBase(baseArgs());

    expect(result.release).toMatchObject({ tag_name: "v1.0.0" });
    expect(result.error).toBeNull();
    expect(result.newEtag).toBe('"abc123"');

    const firstCall =
      fetchMocks.fetchJsonResponseWithRetryAuthChain.mock.calls[0];
    expect(firstCall[0]).toBe(
      "https://example.forgejo.test/api/v1/repos/owner/repo/releases?limit=30&page=1",
    );
  });

  it("uses the provider-latest endpoint when strategy is provider_latest", async () => {
    const release = forgejoRelease();
    const response = jsonResponse(200, release);

    fetchMocks.fetchJsonResponseWithRetryAuthChain.mockResolvedValue({
      response,
      data: release,
    });

    const result = await fetchLatestReleaseFromForgejoBase(
      baseArgs({
        repoSettings: createRepoSettings({
          releaseSelectionStrategy: "provider_latest",
        }),
      }),
    );

    expect(result.release).toMatchObject({ tag_name: "v1.0.0" });
    expect(result.error).toBeNull();

    const firstCall =
      fetchMocks.fetchJsonResponseWithRetryAuthChain.mock.calls[0];
    expect(firstCall[0]).toBe(
      "https://example.forgejo.test/api/v1/repos/owner/repo/releases/latest",
    );
    expect(
      fetchMocks.fetchJsonResponseWithRetryAuthChain,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns not_modified when the server responds with 304", async () => {
    const cachedRelease = forgejoRelease();
    const response = new Response(null, {
      status: 304,
      headers: { Etag: '"cached-etag"' },
    });

    fetchMocks.fetchJsonResponseWithRetryAuthChain.mockResolvedValue({
      response,
      data: null,
    });

    const result = await fetchLatestReleaseFromForgejoBase(
      baseArgs({
        repoSettings: createRepoSettings({
          etag: '"cached-etag"',
          latestRelease: cachedRelease,
        }),
      }),
    );

    expect(result.release).toBeNull();
    expect(result.error).toEqual({ type: "not_modified" });
    expect(result.newEtag).toBe('"cached-etag"');
    expect(
      fetchMocks.fetchJsonResponseWithRetryAuthChain,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns repo_not_found when both releases and repo info return 404", async () => {
    const notFoundResponse = jsonResponse(404, {});
    fetchMocks.fetchJsonResponseWithRetryAuthChain
      .mockResolvedValueOnce({ response: notFoundResponse, data: [] })
      .mockResolvedValueOnce({ response: notFoundResponse, data: {} });

    const result = await fetchLatestReleaseFromForgejoBase(baseArgs());

    expect(result.release).toBeNull();
    expect(result.error).toEqual({ type: "repo_not_found" });
  });

  it("returns rate_limit when the API responds with 429", async () => {
    const rateLimitResponse = jsonResponse(
      429,
      {},
      {
        "Retry-After": "60",
      },
    );
    fetchMocks.fetchJsonResponseWithRetryAuthChain.mockResolvedValue({
      response: rateLimitResponse,
      data: null,
    });

    const result = await fetchLatestReleaseFromForgejoBase(baseArgs());

    expect(result.release).toBeNull();
    expect(result.error).toEqual({ type: "rate_limit" });
  });

  it("falls back to tags when the releases endpoint returns 404 but the repo exists", async () => {
    const commitSha = "a".repeat(40);
    const commitUrl = `https://example.forgejo.test/owner/repo/commit/${commitSha}`;
    const tagsResponse = jsonResponse(200, [
      {
        name: "v1.0.0",
        commit: {
          sha: commitSha,
        },
      },
    ]);
    const repoInfoResponse = jsonResponse(200, { has_releases: false });
    fetchMocks.fetchJsonResponseWithRetryAuthChain
      .mockResolvedValueOnce({
        response: jsonResponse(404, {}),
        data: [],
      })
      .mockResolvedValueOnce({
        response: repoInfoResponse,
        data: { has_releases: false },
      })
      .mockResolvedValueOnce({
        response: tagsResponse,
        data: [
          {
            name: "v1.0.0",
            commit: { sha: commitSha },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: jsonResponse(200, {
          sha: commitSha,
          html_url: commitUrl,
          created: "2024-01-01T00:00:00Z",
          message: "Commit message for tag",
        }),
        data: {
          sha: commitSha,
          html_url: commitUrl,
          created: "2024-01-01T00:00:00Z",
          message: "Commit message for tag",
        },
      });

    const result = await fetchLatestReleaseFromForgejoBase(baseArgs());

    expect(logMock.info).toHaveBeenCalledWith(
      expect.stringContaining("reason=releases_endpoint_404"),
    );
    expect(result.error).toBeNull();
    expect(result.release).toMatchObject({
      tag_name: "v1.0.0",
      name: "Tag: v1.0.0",
      body: expect.stringContaining("Commit message for tag"),
      published_at: "2024-01-01T00:00:00Z",
      created_at: "2024-01-01T00:00:00Z",
    });

    const commitCall =
      fetchMocks.fetchJsonResponseWithRetryAuthChain.mock.calls[3];
    expect(commitCall[0]).toBe(
      `https://example.forgejo.test/api/v1/repos/owner/repo/commits/${commitSha}`,
    );
  });

  it("does not send If-None-Match when strategy is provider_latest", async () => {
    const cachedRelease = forgejoRelease();
    const release = forgejoRelease({ tag_name: "v2.0.0", name: "v2.0.0" });
    const response = jsonResponse(200, release);

    fetchMocks.fetchJsonResponseWithRetryAuthChain.mockResolvedValue({
      response,
      data: release,
    });

    const result = await fetchLatestReleaseFromForgejoBase(
      baseArgs({
        repoSettings: createRepoSettings({
          releaseSelectionStrategy: "provider_latest",
          etag: '"cached-etag"',
          latestRelease: cachedRelease,
        }),
      }),
    );

    expect(result.release).toMatchObject({ tag_name: "v2.0.0" });
    expect(result.error).toBeNull();

    const firstCall =
      fetchMocks.fetchJsonResponseWithRetryAuthChain.mock.calls[0];
    const requestInit = firstCall[1] as Array<{
      options: { headers: Record<string, string> };
    }>;
    const hasIfNoneMatch = requestInit.some((chainEntry) =>
      Boolean(chainEntry.options.headers["If-None-Match"]),
    );
    expect(hasIfNoneMatch).toBe(false);
  });

  it("aggregates releases across multiple pages", async () => {
    const pageOneReleases = Array.from({ length: 50 }, (_, index) =>
      forgejoRelease({ id: index + 2, tag_name: `v2.${index}.0` }),
    );
    const olderReleases = [
      forgejoRelease({ id: 52, tag_name: "v1.0.0" }),
      forgejoRelease({ id: 53, tag_name: "v0.9.0" }),
    ];
    fetchMocks.fetchJsonResponseWithRetryAuthChain
      .mockResolvedValueOnce({
        response: jsonResponse(200, pageOneReleases, {
          Etag: '"page1"',
        }),
        data: pageOneReleases,
      })
      .mockResolvedValueOnce({
        response: jsonResponse(200, olderReleases),
        data: olderReleases,
      });

    const result = await fetchLatestReleaseFromForgejoBase(
      baseArgs({
        repoSettings: createRepoSettings({ releasesPerPage: 52 }),
      }),
    );

    expect(result.error).toBeNull();
    expect(result.newEtag).toBe('"page1"');
    expect(result.release).toMatchObject({ tag_name: "v2.0.0" });

    const calls = fetchMocks.fetchJsonResponseWithRetryAuthChain.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(
      "https://example.forgejo.test/api/v1/repos/owner/repo/releases?limit=50&page=1",
    );
    expect(calls[1][0]).toBe(
      "https://example.forgejo.test/api/v1/repos/owner/repo/releases?limit=2&page=2",
    );
  });
});

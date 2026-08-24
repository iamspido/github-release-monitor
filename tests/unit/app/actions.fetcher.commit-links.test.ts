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

import { toCachedRelease } from "@/lib/releases/filters";
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
        commit_links: [],
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

  it("refreshes legacy cached releases before reusing their ETag", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "o/r",
      url: "https://github.com/o/r",
      etag: 'W/"legacy"',
      latestRelease: {
        html_url: "https://github.com/o/r/releases/tag/v1",
        tag_name: "v1",
        name: "v1",
        body: "Commit 1234567",
        created_at: "2026-01-01T00:00:00Z",
        published_at: "2026-01-01T00:00:00Z",
      },
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          headers: { etag: 'W/"current"' },
          json: [
            {
              id: 1,
              html_url: "https://github.com/o/r/releases/tag/v1",
              tag_name: "v1",
              name: "v1",
              body: "Commit 1234567",
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
          text: '<div data-test-selector="body-content"><p>Commit 1234567</p></div>',
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBeUndefined();
    expect(enriched[0].release?.commit_links).toEqual([]);
    expect(
      Date.parse(enriched[0].release?.commit_links_resolved_at ?? ""),
    ).toBeGreaterThan(0);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
    expect(enriched[0].newEtag).toBe('W/"current"');
  });

  it("stores canonical commit links resolved from the selected GitHub release page", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };
    const numericSha = "1234567890123456789012345678901234567890";

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "- 1234567 Valid commit\n- c0ffee1 Arbitrary identifier",
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
          text: `
            <a href="/owner/repo/commit/c0ffee1234567890123456789012345678901234">c0ffee1</a>
            <div data-test-selector="body-content" class="markdown-body">
              <a href="/owner/repo/commit/${numericSha}">1234567</a><span>c0ffee1</span>
            </div>
          `,
        }),
      );
    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const releaseCall = vi.mocked(global.fetch).mock.calls[0];

    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: "1234567",
        sha: numericSha,
        url: `https://github.com/owner/repo/commit/${numericSha}`,
      },
    ]);
    expect(
      Date.parse(enriched[0].release?.commit_links_resolved_at ?? ""),
    ).toBeGreaterThan(0);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
    expect(headerRecord(fetchCallHeaders(releaseCall)).Accept).toBe(
      "application/vnd.github+json",
    );
    const releasePageCall = vi.mocked(global.fetch).mock.calls[1];
    expect(releasePageCall[0]).toBe(
      "https://github.com/owner/repo/releases/tag/v1.0.0",
    );
    expect(headerRecord(fetchCallHeaders(releasePageCall)).Accept).toBe(
      "text/html",
    );
  });

  it("reuses resolved commit links for an unchanged provider-latest release", async () => {
    const actions = await import("@/app/actions");
    const fullSha = "1234567890123456789012345678901234567890";
    const release = {
      html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      tag_name: "v1.0.0",
      name: "v1.0.0",
      body: "Commit 1234567",
      created_at: "2026-01-01T00:00:00Z",
      published_at: "2026-01-01T00:00:00Z",
    };
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      releaseSelectionStrategy: "provider_latest",
      latestRelease: {
        ...release,
        commit_links: [
          {
            ref: "1234567",
            sha: fullSha,
            url: `https://github.com/owner/repo/commit/${fullSha}`,
          },
        ],
        commit_links_resolved_at: new Date().toISOString(),
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        json: { ...release, id: 1, prerelease: false, draft: false },
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.commit_links).toEqual(
      repo.latestRelease?.commit_links,
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("refreshes expired commit-link metadata without a releases ETag", async () => {
    const actions = await import("@/app/actions");
    const fullSha = "1234567890123456789012345678901234567890";
    const release = {
      html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      tag_name: "v1.0.0",
      name: "v1.0.0",
      body: "Commit 1234567",
      created_at: "2026-01-01T00:00:00Z",
      published_at: "2026-01-01T00:00:00Z",
    };
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      etag: 'W/"previous"',
      latestRelease: {
        ...release,
        commit_links: [
          {
            ref: "1234567",
            sha: fullSha,
            url: `https://github.com/owner/repo/commit/${fullSha}`,
          },
        ],
        commit_links_resolved_at: "2020-01-01T00:00:00.000Z",
      },
    };
    const startedAt = Date.now();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [{ ...release, id: 1, prerelease: false, draft: false }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          text: `<div data-test-selector="body-content"><a href="/owner/repo/commit/${fullSha}"><tt>1234567</tt></a></div>`,
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(headerRecord(fetchCallHeaders(calls[0]))["If-None-Match"]).toBe(
      undefined,
    );
    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: "1234567",
        sha: fullSha,
        url: `https://github.com/owner/repo/commit/${fullSha}`,
      },
    ]);
    expect(
      Date.parse(enriched[0].release?.commit_links_resolved_at ?? ""),
    ).toBeGreaterThanOrEqual(startedAt);
    expect(calls).toHaveLength(2);
  });

  it("resolves commit links against the canonical repository after a rename", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "old-owner/old-repo",
      url: "https://github.com/old-owner/old-repo",
    };
    const fullSha = "abcdef0123456789abcdef0123456789abcdef01";

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url:
                "https://github.com/new-owner/new-repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "Commit abcdef0",
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
          text: `<div data-test-selector="body-content"><a href="/new-owner/new-repo/commit/${fullSha}"><tt>abcdef0</tt></a></div>`,
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: "abcdef0",
        sha: fullSha,
        url: `https://github.com/new-owner/new-repo/commit/${fullSha}`,
      },
    ]);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe(
      "https://github.com/new-owner/new-repo/releases/tag/v1.0.0",
    );
  });

  it("does not mark commit references resolved when rendered HTML is missing", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "Commit 1234567",
              created_at: "2026-01-01T00:00:00Z",
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 500 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 500 }));

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.commit_links).toBeUndefined();
    expect(enriched[0].release?.commit_links_retry).toEqual(
      expect.objectContaining({ attempts: 1 }),
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(global.fetch).mock.calls[2][0]).toBe(
      "https://api.github.com/markdown",
    );
  });

  it("backs off after a successful GitHub error page while retaining ETag support", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          headers: { etag: 'W/"current"' },
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "Commit 1234567",
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
          text: `
            <meta name="description" content="Commit 1234567">
            <link rel="canonical" href="https://github.com/owner/repo/releases/tag/1234567">
            Something went wrong. Please reload.
          `,
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 500 }));

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.commit_links).toBeUndefined();
    expect(enriched[0].release?.commit_links_retry).toEqual(
      expect.objectContaining({ attempts: 1 }),
    );
    expect(
      Date.parse(enriched[0].release?.commit_links_retry?.retry_at ?? ""),
    ).toBeGreaterThan(Date.now());
    expect(enriched[0].newEtag).toBe('W/"current"');

    const firstRelease = enriched[0].release;
    if (!firstRelease)
      throw new Error("Expected the first release fetch to succeed.");
    repo.latestRelease = toCachedRelease(firstRelease);
    repo.etag = enriched[0].newEtag ?? undefined;
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 304 }),
    );

    const secondResult = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(secondResult[0].error?.type).toBe("not_modified");
    expect(secondResult[0].release?.commit_links_retry).toEqual(
      firstRelease.commit_links_retry,
    );
    expect(calls).toHaveLength(4);
    expect(headerRecord(fetchCallHeaders(calls[3]))["If-None-Match"]).toBe(
      'W/"current"',
    );
  });

  it("retries commit-link enrichment after the backoff expires", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      etag: 'W/"previous"',
      latestRelease: {
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "Commit 1234567",
        commit_links_retry: {
          attempts: 1,
          retry_at: "2020-01-01T00:00:00.000Z",
        },
        created_at: "2026-01-01T00:00:00Z",
        published_at: "2026-01-01T00:00:00Z",
      },
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "Commit 1234567",
              created_at: "2026-01-01T00:00:00Z",
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 500 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 500 }));
    const startedAt = Date.now();

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(
      headerRecord(fetchCallHeaders(calls[0]))["If-None-Match"],
    ).toBeUndefined();
    expect(enriched[0].release?.commit_links_retry?.attempts).toBe(2);
    expect(
      Date.parse(enriched[0].release?.commit_links_retry?.retry_at ?? ""),
    ).toBeGreaterThanOrEqual(startedAt + 30 * 60 * 1000);
    expect(calls).toHaveLength(3);
  });

  it("uses one unauthenticated Markdown fallback after a failed public release page request", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };
    const fullSha = "c0ffee1234567890123456789012345678901234";

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: `Fix ${fullSha.slice(0, 7)}`,
              created_at: "2026-01-01T00:00:00Z",
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
            },
          ],
        }),
      )
      .mockRejectedValueOnce(new TypeError("release page unavailable"))
      .mockResolvedValueOnce(
        mockFetchResponse({
          text: `<a href="/owner/repo/commit/${fullSha}">${fullSha.slice(0, 7)}</a>`,
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: fullSha.slice(0, 7),
        sha: fullSha,
        url: `https://github.com/owner/repo/commit/${fullSha}`,
      },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[2][0]).toBe("https://api.github.com/markdown");
    expect(
      headerRecord(fetchCallHeaders(calls[2])).Authorization,
    ).toBeUndefined();
  });

  it("falls back to authenticated Markdown rendering for a private release page", async () => {
    const previousToken = process.env.GITHUB_ACCESS_TOKEN;
    process.env.GITHUB_ACCESS_TOKEN = "test-token";

    try {
      const actions = await import("@/app/actions");
      const repo: Repository = {
        id: "owner/repo",
        url: "https://github.com/owner/repo",
      };
      const fullSha = "c0ffee1234567890123456789012345678901234";
      const signInResponse = mockFetchResponse({
        text: `Sign in to view ${fullSha.slice(0, 7)}`,
      });
      Object.defineProperty(signInResponse, "url", {
        value:
          "https://github.com/login?return_to=%2Fowner%2Frepo%2Freleases%2Ftag%2Fv1.0.0",
      });

      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse({
            json: [
              {
                id: 1,
                html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
                tag_name: "v1.0.0",
                name: "v1.0.0",
                body: `Fix ${fullSha.slice(0, 7)}`,
                created_at: "2026-01-01T00:00:00Z",
                published_at: "2026-01-01T00:00:00Z",
                prerelease: false,
                draft: false,
              },
            ],
          }),
        )
        .mockResolvedValueOnce(signInResponse)
        .mockResolvedValueOnce(
          mockFetchResponse({
            text: `<a href="/owner/repo/commit/${fullSha}">${fullSha.slice(0, 7)}</a>`,
          }),
        );

      const enriched = await actions.getLatestReleasesForRepos(
        [repo],
        baseSettings,
        "en",
        { skipCache: true },
      );
      const calls = vi.mocked(global.fetch).mock.calls;

      expect(enriched[0].release?.commit_links).toEqual([
        {
          ref: fullSha.slice(0, 7),
          sha: fullSha,
          url: `https://github.com/owner/repo/commit/${fullSha}`,
        },
      ]);
      expect(calls).toHaveLength(3);
      expect(
        headerRecord(fetchCallHeaders(calls[1])).Authorization,
      ).toBeUndefined();
      expect(headerRecord(fetchCallHeaders(calls[2])).Authorization).toBe(
        "token test-token",
      );
    } finally {
      if (previousToken === undefined) {
        delete process.env.GITHUB_ACCESS_TOKEN;
      } else {
        process.env.GITHUB_ACCESS_TOKEN = previousToken;
      }
    }
  });

  it("accepts an authoritative empty result without an authenticated fallback", async () => {
    const previousToken = process.env.GITHUB_ACCESS_TOKEN;
    process.env.GITHUB_ACCESS_TOKEN = "test-token";

    try {
      const actions = await import("@/app/actions");
      const repo: Repository = {
        id: "owner/repo",
        url: "https://github.com/owner/repo",
      };

      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse({
            json: [
              {
                id: 1,
                html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
                tag_name: "v1.0.0",
                name: "v1.0.0",
                body: "Build 20260824",
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
            text: '<div data-test-selector="body-content" class="markdown-body"><p>Build 20260824</p></div>',
          }),
        );

      const enriched = await actions.getLatestReleasesForRepos(
        [repo],
        baseSettings,
        "en",
        { skipCache: true },
      );

      expect(enriched[0].release?.commit_links).toEqual([]);
      expect(
        Date.parse(enriched[0].release?.commit_links_resolved_at ?? ""),
      ).toBeGreaterThan(0);
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.some(
            ([url]) => String(url) === "https://api.github.com/markdown",
          ),
      ).toBe(false);
    } finally {
      if (previousToken === undefined) {
        delete process.env.GITHUB_ACCESS_TOKEN;
      } else {
        process.env.GITHUB_ACCESS_TOKEN = previousToken;
      }
    }
  });

  it("resolves commit links from a locally generated empty-body fallback", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };
    const fullSha = "abcdef0123456789abcdef0123456789abcdef01";

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              id: 1,
              html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "",
              body_html: `<a href="/owner/repo/commit/1111111111111111111111111111111111111111">1111111</a>`,
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
          status: 200,
          json: { commit: { message: `Fix ${fullSha.slice(0, 7)}` } },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          text: `<a href="https://github.com/owner/repo/commit/${fullSha}">${fullSha.slice(0, 7)}</a>`,
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );
    const calls = vi.mocked(global.fetch).mock.calls;

    expect(enriched[0].release?.body).toContain(`Fix ${fullSha.slice(0, 7)}`);
    expect(enriched[0].release?.commit_links).toEqual([
      {
        ref: fullSha.slice(0, 7),
        sha: fullSha,
        url: `https://github.com/owner/repo/commit/${fullSha}`,
      },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[1][0]).toBe(
      "https://api.github.com/repos/owner/repo/commits/v1.0.0",
    );
    expect(calls[2][0]).toBe("https://api.github.com/markdown");
    expect(JSON.parse(fetchCallBodyText(calls[2]))).toEqual(
      expect.objectContaining({
        context: "owner/repo",
        mode: "gfm",
        text: expect.stringContaining(`Fix ${fullSha.slice(0, 7)}`),
      }),
    );
  });
});

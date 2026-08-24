// vitest globals enabled

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

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

describe("actions self-hosted Forgejo fetcher", () => {
  const fetchBackup = global.fetch;
  const settings: AppSettings = {
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
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "http://forgejo.internal.test:3000/code";
    delete process.env.FORGEJO_ACCESS_TOKENS;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    delete process.env.FORGEJO_ACCESS_TOKENS;
  });

  it("uses the configured base URL and retries token authentication as bearer", async () => {
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    const release = {
      id: 1,
      html_url: " ",
      tag_name: "v1.2.3",
      name: "v1.2.3",
      body: "notes",
      created_at: "2026-01-01T00:00:00Z",
      published_at: "2026-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 401 }))
      .mockResolvedValueOnce(
        mockFetchResponse({ status: 200, json: [release] }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v1.2.3",
      html_url:
        "http://forgejo.internal.test:3000/code/owner/repo/releases/tag/v1.2.3",
    });
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/releases?limit=30&page=1",
    );
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))
        .Authorization,
    ).toBe("token forgejo-token");
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[1]))
        .Authorization,
    ).toBe("Bearer forgejo-token");
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
    });
  });

  it("resolves release-note commits on a self-hosted base path", async () => {
    const actions = await import("@/app/actions");
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url:
                "http://forgejo.internal.test:3000/code/owner/repo/releases/tag/v1.0.0",
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
            html_url: `http://forgejo.internal.test:3000/code/owner/repo/commit/${sha}`,
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.commit_links).toEqual([
      {
        ref: "abcdef1",
        sha,
        url: `http://forgejo.internal.test:3000/code/owner/repo/commit/${sha}`,
      },
    ]);
    expect(String(vi.mocked(global.fetch).mock.calls[1][0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/git/commits/abcdef1?stat=false&verification=false&files=false",
    );
  });

  it("accepts commit links below an encoded self-hosted base path", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "http://forgejo.internal.test:3000/code%20hosting";
    const actions = await import("@/app/actions");
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code%20hosting/owner/repo",
      url: "http://forgejo.internal.test:3000/code%20hosting/owner/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              id: 1,
              html_url:
                "http://forgejo.internal.test:3000/code%20hosting/owner/repo/releases/tag/v1.0.0",
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
            html_url: `http://forgejo.internal.test:3000/code%20hosting/owner/repo/commit/${sha}`,
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.commit_links).toEqual([
      {
        ref: "abcdef1",
        sha,
        url: `http://forgejo.internal.test:3000/code%20hosting/owner/repo/commit/${sha}`,
      },
    ]);
  });

  it("follows release redirects within the configured Forgejo base path", async () => {
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 302,
          headers: {
            location:
              "/code/api/v1/repos/owner/repo/releases-canonical?limit=30&page=1",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              id: 1,
              tag_name: "v1.0.0",
              name: "v1.0.0",
              body: "notes",
              created_at: "2026-01-01T00:00:00Z",
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
            },
          ],
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("v1.0.0");
    expect(String(vi.mocked(global.fetch).mock.calls[1]?.[0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/releases-canonical?limit=30&page=1",
    );
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[1]))
        .Authorization,
    ).toBe("token forgejo-token");
  });

  it("rejects release redirects outside the configured Forgejo base path", async () => {
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 302,
        headers: {
          location:
            "http://forgejo.internal.test:3000/other/api/v1/repos/owner/repo/releases",
        },
      }),
    );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result).toMatchObject({ error: { type: "api_error" } });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("falls back from a disabled releases endpoint to tags and both commit endpoints", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({ status: 404, statusText: "Not Found" }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: {} }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [{ name: "v2.0.0", commit: { sha: "abc123" } }],
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 404 }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: {
            message: "Fallback commit notes",
            created: "2026-02-03T04:05:06Z",
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v2.0.0",
      html_url:
        "http://forgejo.internal.test:3000/code/owner/repo/src/tag/v2.0.0",
      published_at: "2026-02-03T04:05:06Z",
    });
    expect(result.release?.body).toContain("Fallback commit notes");
    expect(
      vi.mocked(global.fetch).mock.calls.map((call) => String(call[0])),
    ).toEqual([
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/releases?limit=30&page=1",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/tags?limit=30&page=1",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/commits/abc123",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/git/commits/abc123",
    ]);
  });

  it("combines partial metadata from both commit endpoints", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [{ name: "v2.1.0", commit: { sha: "partial123" } }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: { message: "Commit notes from the first endpoint" },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: { committer: { date: "2026-02-05T04:05:06Z" } },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v2.1.0",
      published_at: "2026-02-05T04:05:06Z",
      published_at_unknown: false,
    });
    expect(result.release?.body).toContain(
      "Commit notes from the first endpoint",
    );
    expect(
      vi.mocked(global.fetch).mock.calls.map((call) => String(call[0])),
    ).toEqual([
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/releases?limit=30&page=1",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/tags?limit=30&page=1",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/commits/partial123",
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/git/commits/partial123",
    ]);
  });

  it("uses nested commit metadata when earlier fields are blank", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [{ name: "v2.1.1", commit: { sha: "nested123" } }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: {
            message: "   ",
            author: { date: "" },
            commit: {
              message: "Nested commit notes",
              author: { date: "2026-02-05T05:06:07Z" },
            },
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v2.1.1",
      published_at: "2026-02-05T05:06:07Z",
      published_at_unknown: false,
    });
    expect(result.release?.body).toContain("Nested commit notes");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("uses tag commit timestamps before selecting the newest fallback", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              name: "v1.0.0",
              message: "older tag",
              commit: {
                sha: "older123",
                created: "2026-01-01T00:00:00Z",
              },
            },
            {
              name: "v2.0.0",
              message: "newer tag",
              commit: {
                sha: "newer123",
                created: "2026-02-01T00:00:00Z",
              },
            },
          ],
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v2.0.0",
      created_at: "2026-02-01T00:00:00Z",
      published_at: "2026-02-01T00:00:00Z",
      published_at_unknown: false,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("loads missing tag timestamps before selecting the newest fallback", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        return mockFetchResponse({ status: 200, json: [] });
      }
      if (url.includes("/tags?")) {
        return mockFetchResponse({
          status: 200,
          json: [
            {
              name: "v1.0.0",
              message: "older tag",
              commit: { sha: "older123" },
            },
            {
              name: "v2.0.0",
              message: "newer tag",
              commit: { sha: "newer123" },
            },
          ],
        });
      }
      if (url.endsWith("/commits/older123")) {
        return mockFetchResponse({
          status: 200,
          json: {
            message: "older commit",
            created: "2026-01-01T00:00:00Z",
          },
        });
      }
      if (url.endsWith("/commits/newer123")) {
        return mockFetchResponse({
          status: 200,
          json: {
            message: "newer commit",
            created: "2026-02-01T00:00:00Z",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toMatchObject({
      tag_name: "v2.0.0",
      created_at: "2026-02-01T00:00:00Z",
      published_at: "2026-02-01T00:00:00Z",
      published_at_unknown: false,
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it.each(["", "   "])(
    "uses commit notes when the tag message is blank (case %#)",
    async (tagMessage) => {
      const actions = await import("@/app/actions");
      const repo: Repository = {
        id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
        url: "http://forgejo.internal.test:3000/code/owner/repo",
      };
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
        .mockResolvedValueOnce(
          mockFetchResponse({
            status: 200,
            json: [
              {
                name: "v2.2.0",
                message: tagMessage,
                commit: { sha: "blank123" },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({
            status: 200,
            json: {
              message: "Commit notes for a blank tag message",
              committer: { date: "2026-02-06T04:05:06Z" },
            },
          }),
        );

      const [result] = await actions.getLatestReleasesForRepos(
        [repo],
        settings,
        "en",
        { skipCache: true },
      );

      expect(result.release?.body).toContain(
        "Commit notes for a blank tag message",
      );
      expect(global.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it("URL-encodes tag names used as commit references", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [{ name: "release/v2.1.0" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: {
            message: "Encoded reference",
            committer: { date: "2026-02-04T04:05:06Z" },
          },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("release/v2.1.0");
    expect(String(vi.mocked(global.fetch).mock.calls[2]?.[0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/commits/release%2Fv2.1.0",
    );
  });

  it("falls back through per_page and unpaginated tag URLs", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 400 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 400 }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [{ name: "v3.0.0", message: "tag notes" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: { message: "tag notes" },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("v3.0.0");
    const urls = vi
      .mocked(global.fetch)
      .mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/tags?limit=30&page=1",
        "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/tags?per_page=30&page=1",
        "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/tags",
      ]),
    );
  });

  it("treats a large unpaginated tag response as complete", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 51,
    };
    const tags = Array.from({ length: 60 }, (_, index) => ({
      name: `v${60 - index}.0.0`,
      message: "tag notes",
    }));
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        return mockFetchResponse({ status: 200, json: [] });
      }
      if (url.includes("/tags?")) {
        return mockFetchResponse({ status: 400 });
      }
      if (url.endsWith("/tags")) {
        return mockFetchResponse({ status: 200, json: tags });
      }
      if (url.includes("/commits/")) {
        return mockFetchResponse({
          status: 200,
          json: {
            message: "tag notes",
            author: { date: "2026-01-01T00:00:00Z" },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("v60.0.0");
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(
          ([input]) => new URL(String(input)).searchParams.get("page") === "2",
        ),
    ).toBe(false);
  });

  it("falls back to anonymous access after token and bearer are rejected", async () => {
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 401 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 403 }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          json: [
            {
              id: 4,
              tag_name: "v4.0.0",
              name: "v4.0.0",
              body: "public release",
              created_at: "2026-04-01T00:00:00Z",
              published_at: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(result.release?.tag_name).toBe("v4.0.0");
    expect(headerRecord(fetchCallHeaders(calls[0])).Authorization).toBe(
      "token forgejo-token",
    );
    expect(headerRecord(fetchCallHeaders(calls[1])).Authorization).toBe(
      "Bearer forgejo-token",
    );
    expect(
      headerRecord(fetchCallHeaders(calls[2])).Authorization,
    ).toBeUndefined();
  });

  it("does not continue the auth chain after a rate-limited forbidden response", async () => {
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 403,
        headers: { "retry-after": "60" },
      }),
    );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.error?.type).toBe("rate_limit");
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))
        .Authorization,
    ).toBe("token forgejo-token");
  });

  it("uses the provider-latest endpoint without a tag fallback", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      releaseSelectionStrategy: "provider_latest",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: {
          id: 5,
          tag_name: "v5.0.0",
          name: "v5.0.0",
          body: "latest",
          created_at: "2026-05-01T00:00:00Z",
          published_at: "2026-05-01T00:00:00Z",
        },
      }),
    );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("v5.0.0");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo/releases/latest",
    );
  });

  it("applies repository filters to Forgejo releases", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      includeRegex: "^v1\\.",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            id: 7,
            tag_name: "v2.0.0",
            name: "v2.0.0",
            body: "newer but excluded",
            created_at: "2026-07-02T00:00:00Z",
            published_at: "2026-07-02T00:00:00Z",
          },
          {
            id: 6,
            tag_name: "v1.9.0",
            name: "v1.9.0",
            body: "matching",
            created_at: "2026-07-01T00:00:00Z",
            published_at: "2026-07-01T00:00:00Z",
          },
        ],
      }),
    );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release?.tag_name).toBe("v1.9.0");
  });

  it("maps a missing repository after the releases fallback probe", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/missing",
      url: "http://forgejo.internal.test:3000/code/owner/missing",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 404 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 404 }));

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toBeUndefined();
    expect(result.error?.type).toBe("repo_not_found");
  });

  it.each([
    { status: 429, headers: { "retry-after": "" } },
    { status: 403, headers: { "retry-after": "60" } },
  ])(
    "maps a $status repository fallback probe to rate_limit",
    async ({ status, headers }) => {
      const actions = await import("@/app/actions");
      const repo: Repository = {
        id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
        url: "http://forgejo.internal.test:3000/code/owner/repo",
      };
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockFetchResponse({ status: 404 }))
        .mockResolvedValueOnce(
          mockFetchResponse({
            status,
            statusText: "Rate limited",
            headers,
          }),
        );

      const [result] = await actions.getLatestReleasesForRepos(
        [repo],
        settings,
        "en",
        { skipCache: true },
      );

      expect(result.release).toBeUndefined();
      expect(result.error?.type).toBe("rate_limit");
    },
  );

  it("reconstructs a cached release after a matching ETag", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      etag: 'W/"forgejo-etag"',
      latestRelease: {
        html_url:
          "http://forgejo.internal.test:3000/code/owner/repo/releases/tag/v6.0.0",
        tag_name: "v6.0.0",
        name: "v6.0.0",
        body: "cached",
        created_at: "2026-06-01T00:00:00Z",
        published_at: "2026-06-01T00:00:00Z",
      },
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 304, headers: { etag: 'W/"new"' } }),
    );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.error?.type).toBe("not_modified");
    expect(result.release?.tag_name).toBe("v6.0.0");
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBe('W/"forgejo-etag"');
  });

  it("refuses partial tag results after a later page fails", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 51,
    };
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      message: "tag",
    }));
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        return mockFetchResponse({ status: 200, json: [] });
      }
      if (
        url.includes("/tags?") &&
        new URL(url).searchParams.get("page") === "1"
      ) {
        return mockFetchResponse({ status: 200, json: firstPage });
      }
      if (url.includes("/tags?")) throw new Error("page two failed");
      throw new Error(`Unexpected request: ${url}`);
    });

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toBeUndefined();
    expect(result.error?.type).toBe("api_error");
  });

  it("stops tag endpoint variants when the first one is rate limited", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
    };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 429,
          headers: { "retry-after": "60" },
        }),
      );

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.error?.type).toBe("rate_limit");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(global.fetch).mock.calls[1]?.[0])).toContain(
      "/tags?limit=30&page=1",
    );
  });

  it("refuses partial tags when a later page has no JSON payload", async () => {
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      url: "http://forgejo.internal.test:3000/code/owner/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 51,
    };
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      message: "tag",
    }));
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        return mockFetchResponse({ status: 200, json: [] });
      }
      if (
        url.includes("/tags?") &&
        new URL(url).searchParams.get("page") === "1"
      ) {
        return mockFetchResponse({ status: 200, json: firstPage });
      }
      if (url.includes("/tags?")) {
        return mockFetchResponse({ status: 200, json: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const [result] = await actions.getLatestReleasesForRepos(
      [repo],
      settings,
      "en",
      { skipCache: true },
    );

    expect(result.release).toBeUndefined();
    expect(result.error?.type).toBe("api_error");
  });
});

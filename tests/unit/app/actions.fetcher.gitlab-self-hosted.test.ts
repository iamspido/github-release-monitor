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

import { deflateSync } from "node:zlib";
import type { AppSettings, Repository } from "@/types";
import {
  fetchCallHeaders,
  headerRecord,
  installFetchMock,
  mockFetchResponse,
} from "../helpers/fetch";

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodePktLine(text: string): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(text);
  const header = encoder.encode(
    (payload.length + 4).toString(16).padStart(4, "0"),
  );
  return concatBytes([header, payload]);
}

function encodePktPayload(payload: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode(
    (payload.length + 4).toString(16).padStart(4, "0"),
  );
  return concatBytes([header, payload]);
}

function encodePackObjectHeader(type: number, objectSize: number): Uint8Array {
  const bytes: number[] = [];
  let size = objectSize;
  let first = (type << 4) | (size & 0x0f);
  size >>= 4;
  if (size > 0) first |= 0x80;
  bytes.push(first);

  while (size > 0) {
    let current = size & 0x7f;
    size >>= 7;
    if (size > 0) current |= 0x80;
    bytes.push(current);
  }

  return Uint8Array.from(bytes);
}

function buildUploadPackResponseForSingleCommit(
  commitMessage: string,
  epochSeconds: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const commitObject = `tree 1111111111111111111111111111111111111111\nauthor Test <test@example.test> ${epochSeconds} +0000\ncommitter Test <test@example.test> ${epochSeconds} +0000\n\n${commitMessage}\n`;
  const commitBytes = encoder.encode(commitObject);
  const objectHeader = encodePackObjectHeader(1, commitBytes.length);
  const compressed = deflateSync(commitBytes);

  const packPayload = concatBytes([
    encoder.encode("PACK"),
    Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 1]),
    objectHeader,
    compressed,
    new Uint8Array(20),
  ]);

  const sidebandPacket = new Uint8Array(packPayload.length + 1);
  sidebandPacket[0] = 1;
  sidebandPacket.set(packPayload, 1);

  return concatBytes([
    encodePktLine("NAK\n"),
    encodePktPayload(sidebandPacket),
    encoder.encode("0000"),
  ]);
}

describe("actions GitLab self-hosted fetcher", () => {
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
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("does not use a page-one ETag for highest-version selection", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 101,
      etag: 'W/"page-one"',
      latestRelease: {
        html_url: "https://gitlab.self.test/group/repo/-/releases/v1.0.0",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "body",
        created_at: "2024-01-01T00:00:00Z",
        published_at: "2024-01-01T00:00:00Z",
      },
    };

    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v${index + 1}.0.0`,
      name: `v${index + 1}.0.0`,
      description: "body",
      created_at: "2024-02-01T00:00:00Z",
      released_at: "2024-02-01T00:00:00Z",
      upcoming_release: false,
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: firstPage }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        json: [
          {
            tag_name: "v999.0.0",
            name: "v999.0.0",
            description: "body",
            created_at: "2024-02-01T00:00:00Z",
            released_at: "2024-02-01T00:00:00Z",
            upcoming_release: false,
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

  it("uses allowed self-hosted GitLab host and host-specific token", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [
          {
            tag_name: "v1.2.3",
            name: "v1.2.3",
            description: "release body",
            created_at: new Date().toISOString(),
            released_at: new Date().toISOString(),
            upcoming_release: false,
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

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1.2.3");

    const requestCall = vi.mocked(global.fetch).mock.calls[0];
    const [requestUrl] = requestCall;
    expect(requestUrl).toContain(
      "https://gitlab.self.test/api/v4/projects/group%2Frepo/releases",
    );
    expect(headerRecord(fetchCallHeaders(requestCall))["PRIVATE-TOKEN"]).toBe(
      "glpat-self",
    );
  });

  it("resolves release-note commit references through the GitLab commit API", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              tag_name: "v1.2.3",
              name: "v1.2.3",
              description: "Fix abcdef1",
              created_at: "2026-01-01T00:00:00Z",
              released_at: "2026-01-01T00:00:00Z",
              upcoming_release: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: {
            id: sha,
            web_url: `https://gitlab.self.test/group/repo/-/commit/${sha}`,
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
        url: `https://gitlab.self.test/group/repo/-/commit/${sha}`,
      },
    ]);
    expect(String(vi.mocked(global.fetch).mock.calls[1][0])).toBe(
      "https://gitlab.self.test/api/v4/projects/group%2Frepo/repository/commits/abcdef1?stats=false",
    );
  });

  it("uses GitLab's provider-latest permalink when configured", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
      releaseSelectionStrategy: "provider_latest",
    };
    const release = {
      tag_name: "v1.2.3",
      name: "v1.2.3",
      description: "release body",
      created_at: "2024-01-01T00:00:00Z",
      released_at: "2024-01-01T00:00:00Z",
      upcoming_release: false,
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

    expect(enriched[0].release?.tag_name).toBe("v1.2.3");
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain(
      "/releases/permalink/latest",
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
  });

  it("falls back to simpler tags endpoint when advanced ordering params are rejected", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
      etag: 'W/"empty-releases"',
      latestRelease: {
        html_url: "https://gitlab.self.test/group/repo/-/tags/v1.0.0",
        tag_name: "v1.0.0",
        name: "Tag: v1.0.0",
        body: "old tag",
        created_at: "2024-01-01T00:00:00Z",
        published_at: "2024-01-01T00:00:00Z",
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
        status: 400,
        statusText: "Bad Request",
        text: "order_by is invalid",
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [
          {
            name: "v2.0.0",
            commit: {
              id: "abc123",
              message: "release commit",
              committed_date: new Date().toISOString(),
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

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v2.0.0");
    expect(enriched[0].newEtag).toBeNull();
    expect(
      headerRecord(fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]))[
        "If-None-Match"
      ],
    ).toBeUndefined();

    const urls = vi.mocked(global.fetch).mock.calls.map((call) => call[0]);
    expect(
      urls.some((u) =>
        String(u).includes(
          "/repository/tags?per_page=30&page=1&order_by=updated&sort=desc",
        ),
      ),
    ).toBe(true);
    expect(
      urls.some((u) =>
        String(u).includes("/repository/tags?per_page=30&page=1"),
      ),
    ).toBe(true);
  });

  it("rejects partial GitLab tag results when a later page fails", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
      releaseSelectionStrategy: "highest_version",
      releasesPerPage: 101,
    };
    const firstPageTags = Array.from({ length: 100 }, (_, index) => ({
      name: `v${index + 1}.0.0`,
      commit: {
        id: String(index + 1),
        message: "release commit",
        committed_date: "2024-01-01T00:00:00Z",
      },
    }));

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: [] }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({ status: 200, json: firstPageTags }),
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 500,
        statusText: "Internal Server Error",
        text: "failed",
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release).toBeUndefined();
    expect(enriched[0].error?.type).toBe("api_error");
    expect(enriched[0].newEtag).toBeNull();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
  });

  it("uses commit metadata when an API tag has no publication date", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");
    const commitDate = "2020-02-03T04:05:06.000Z";
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              name: "v1.2.3",
              message: "tag message",
              commit: { id: "abc123" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: {
            message: "commit message",
            committed_date: commitDate,
          },
        }),
      );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].release?.created_at).toBe(commitDate);
    expect(enriched[0].release?.published_at).toBe(commitDate);
    expect(enriched[0].release?.published_at_unknown).toBe(false);
    expect(enriched[0].release?.body).toContain("tag message");
  });

  it("selects an older matching tag when the newest tag is filtered out", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const actions = await import("@/app/actions");
    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ json: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          json: [
            {
              name: "v2.0.0-beta",
              message: "beta",
              commit: { committed_date: "2026-01-02T00:00:00.000Z" },
            },
            {
              name: "v1.9.0",
              message: "stable",
              commit: { committed_date: "2026-01-01T00:00:00.000Z" },
            },
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

  it("returns api_error when tag fallback endpoint fails", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
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
        status: 403,
        statusText: "Forbidden",
        text: "forbidden",
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error?.type).toBe("api_error");
  });

  it("uses basic auth when only a deploy token is configured", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [
          {
            tag_name: "v1.2.3",
            name: "v1.2.3",
            description: "release body",
            created_at: new Date().toISOString(),
            released_at: new Date().toISOString(),
            upcoming_release: false,
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

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1.2.3");

    const authorizationHeader = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]),
    ).Authorization;
    expect(typeof authorizationHeader).toBe("string");
    expect(authorizationHeader.startsWith("Basic ")).toBe(true);
  });

  it("falls back to tags when releases endpoint returns 404 with deploy token", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: "",
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        json: [
          {
            name: "v2.3.4",
            commit: {
              id: "abc123",
              message: "release commit",
              committed_date: new Date().toISOString(),
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

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v2.3.4");

    const firstAuth = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]),
    ).Authorization;
    const secondAuth = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[1]),
    ).Authorization;
    expect(typeof firstAuth).toBe("string");
    expect(firstAuth.startsWith("Basic ")).toBe(true);
    expect(typeof secondAuth).toBe("string");
    expect(secondAuth.startsWith("Basic ")).toBe(true);
  });

  it("falls back to Git transport when GitLab tag API returns 404 with deploy token", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const commitSha = "6da1bcce308ad6958bbeba67a5f5e5c752a15b40";
    const gitRefsBody = `${pkt("# service=git-upload-pack\n")}0000${pkt(`${commitSha} refs/tags/1.0.0\n`)}0000`;
    const uploadPackResponse = buildUploadPackResponseForSingleCommit(
      "feat: release 1.0.0",
      1_700_000_000,
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(gitRefsBody),
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: uploadPackResponse,
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("1.0.0");
    expect(enriched[0].release?.html_url).toContain("/-/tags/1.0.0");
    expect(enriched[0].release?.published_at_unknown).toBe(false);
    expect(enriched[0].release?.published_at).toBe("2023-11-14T22:13:20.000Z");
    expect(enriched[0].release?.body).toContain("feat: release 1.0.0");

    const urls = vi.mocked(global.fetch).mock.calls.map((call) => call[0]);
    expect(
      urls.some((url) =>
        String(url).includes(
          "/group/repo.git/info/refs?service=git-upload-pack",
        ),
      ),
    ).toBe(true);
    expect(
      urls.some((url) =>
        String(url).includes("/group/repo.git/git-upload-pack"),
      ),
    ).toBe(true);
  });

  it("keeps unknown publish time when git transport pack response is not parseable", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const commitSha = "6da1bcce308ad6958bbeba67a5f5e5c752a15b40";
    const gitRefsBody = `${pkt("# service=git-upload-pack\n")}0000${pkt(`${commitSha} refs/tags/1.0.0\n`)}0000`;
    const invalidUploadPackResponse = new TextEncoder().encode("0008NAK\n0000");

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(gitRefsBody),
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: invalidUploadPackResponse,
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: invalidUploadPackResponse,
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("1.0.0");
    expect(enriched[0].release?.published_at_unknown).toBe(true);
    expect(enriched[0].release?.body).toContain(
      "commit_message_unavailable_fallback",
    );
    expect(enriched[0].release?.body).toContain("6da1bcce308a");
  });

  it("retries git-upload-pack metadata fetch with simpler request when first request fails", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const commitSha = "6da1bcce308ad6958bbeba67a5f5e5c752a15b40";
    const gitRefsBody = `${pkt("# service=git-upload-pack\n")}0000${pkt(`${commitSha} refs/tags/1.0.0\n`)}0000`;
    const uploadPackResponse = buildUploadPackResponseForSingleCommit(
      "fix: fallback commit metadata",
      1_701_000_000,
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 404,
        statusText: "Not Found",
        text: '{"message":"404 Project Not Found"}',
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(gitRefsBody),
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 400,
        statusText: "Bad Request",
        text: "unsupported filter",
      }),
    );

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        statusText: "OK",
        bytes: uploadPackResponse,
      }),
    );

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("1.0.0");
    expect(enriched[0].release?.published_at_unknown).toBe(false);
    expect(enriched[0].release?.published_at).toBe("2023-11-26T12:00:00.000Z");
    expect(enriched[0].release?.body).toContain(
      "fix: fallback commit metadata",
    );

    const uploadPackCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/git-upload-pack"),
      );
    expect(uploadPackCalls.length).toBe(2);
  });
});

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
  const commitObject = `tree 1111111111111111111111111111111111111111\nauthor Test <test@example.com> ${epochSeconds} +0000\ncommitter Test <test@example.com> ${epochSeconds} +0000\n\n${commitMessage}\n`;
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
    // @ts-expect-error
    global.fetch = vi.fn();
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("uses allowed self-hosted GitLab host and host-specific token", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
        {
          tag_name: "v1.2.3",
          name: "v1.2.3",
          description: "release body",
          created_at: new Date().toISOString(),
          released_at: new Date().toISOString(),
          upcoming_release: false,
        },
      ],
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1.2.3");

    // @ts-expect-error
    const [requestUrl, requestOpts] = vi.mocked(global.fetch).mock.calls[0];
    expect(requestUrl).toContain(
      "https://gitlab.self.test/api/v4/projects/group%2Frepo/releases",
    );
    expect(requestOpts.headers["PRIVATE-TOKEN"]).toBe("glpat-self");
  });

  it("falls back to simpler tags endpoint when advanced ordering params are rejected", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    // releases: empty -> tag fallback
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [],
    });

    // tags with order_by/sort rejected by older GitLab
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      text: async () => "order_by is invalid",
    });

    // simpler tags endpoint works
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
        {
          name: "v2.0.0",
          commit: {
            id: "abc123",
            message: "release commit",
            committed_date: new Date().toISOString(),
          },
        },
      ],
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v2.0.0");

    // @ts-expect-error
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => call[0]);
    expect(
      urls.some((u: string) =>
        u.includes("/repository/tags?per_page=1&order_by=updated&sort=desc"),
      ),
    ).toBe(true);
    expect(
      urls.some((u: string) => u.includes("/repository/tags?per_page=1")),
    ).toBe(true);
  });

  it("returns api_error when tag fallback endpoint fails", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const actions = await import("@/app/actions");

    const repo: Repository = {
      id: "gitlab:gitlab.self.test/group/repo",
      url: "https://gitlab.self.test/group/repo",
    };

    // releases: empty -> tag fallback
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [],
    });

    // tags endpoint failure
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: { get: () => null },
      text: async () => "forbidden",
    });

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

    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
        {
          tag_name: "v1.2.3",
          name: "v1.2.3",
          description: "release body",
          created_at: new Date().toISOString(),
          released_at: new Date().toISOString(),
          upcoming_release: false,
        },
      ],
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v1.2.3");

    // @ts-expect-error
    const [, requestOpts] = vi.mocked(global.fetch).mock.calls[0];
    const authorizationHeader = requestOpts.headers.Authorization;
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

    // releases endpoint not accessible with deploy token on some instances
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => "",
    });

    // tags fallback succeeds
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => [
        {
          name: "v2.3.4",
          commit: {
            id: "abc123",
            message: "release commit",
            committed_date: new Date().toISOString(),
          },
        },
      ],
    });

    const enriched = await actions.getLatestReleasesForRepos(
      [repo],
      baseSettings,
      "en",
      { skipCache: true },
    );

    expect(enriched[0].error).toBeUndefined();
    expect(enriched[0].release?.tag_name).toBe("v2.3.4");

    // @ts-expect-error
    const firstAuth = vi.mocked(global.fetch).mock.calls[0][1].headers
      .Authorization;
    // @ts-expect-error
    const secondAuth = vi.mocked(global.fetch).mock.calls[1][1].headers
      .Authorization;
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

    // releases endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // tags endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // git transport fallback -> success with one tag
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(gitRefsBody).buffer,
    });

    // git transport commit metadata lookup
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => uploadPackResponse.buffer,
    });

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

    // @ts-expect-error
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => call[0]);
    expect(
      urls.some((url: string) =>
        url.includes("/group/repo.git/info/refs?service=git-upload-pack"),
      ),
    ).toBe(true);
    expect(
      urls.some((url: string) =>
        url.includes("/group/repo.git/git-upload-pack"),
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
    const invalidUploadPackResponse = new TextEncoder().encode(
      "0008NAK\n0000",
    ).buffer;

    // releases endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // tags endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // git transport refs fallback succeeds
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(gitRefsBody).buffer,
    });

    // first git-upload-pack call returns non-parseable payload
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => invalidUploadPackResponse,
    });

    // second git-upload-pack call also non-parseable
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => invalidUploadPackResponse,
    });

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

    // releases endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // tags endpoint -> 404
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => '{"message":"404 Project Not Found"}',
    });

    // git transport refs fallback succeeds
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(gitRefsBody).buffer,
    });

    // first metadata request fails
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      text: async () => "unsupported filter",
    });

    // second metadata request succeeds
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => uploadPackResponse.buffer,
    });

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

    // @ts-expect-error
    const uploadPackCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/git-upload-pack"),
      );
    expect(uploadPackCalls.length).toBe(2);
  });
});

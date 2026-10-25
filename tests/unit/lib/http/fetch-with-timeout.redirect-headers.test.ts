import http from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithAllowedRedirects,
  fetchWithTimeout,
  OutboundRedirectError,
  OutboundRequestTimeoutError,
} from "@/lib/http/fetch-with-timeout";
import { buildGitlabAuthChain } from "@/lib/releases/auth-chains";
import { fetchJsonResponseWithRetryAuthChain } from "@/lib/releases/fetch";

type ReceivedRequest = {
  path: string;
  headers: http.IncomingHttpHeaders;
};

type LoopbackServer = {
  origin: string;
  requests: ReceivedRequest[];
  redirects: Map<string, string>;
};

const ALLOWED_CROSS_ORIGIN_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
];

const GITLAB_HEADERS = {
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "Accept-Language": "de",
  "User-Agent": "GitHubReleaseMonitorApp",
  "If-None-Match": '"cached-etag"',
};

const GITLAB_AUTH = {
  accessToken: "glpat-loopback-secret",
  deployToken: { username: "deploy-user", token: "deploy-secret" },
};

const servers: http.Server[] = [];

async function startServer(
  options: { status?: number; delayMs?: number } = {},
): Promise<LoopbackServer> {
  const requests: ReceivedRequest[] = [];
  const redirects = new Map<string, string>();
  const server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push({ path, headers: request.headers });
    const respond = () => {
      const location = redirects.get(path);
      if (location) {
        response.writeHead(302, { location });
        response.end();
        return;
      }
      response.writeHead(options.status ?? 200, {
        "content-type": "application/json",
      });
      response.end("{}");
    };
    if (options.delayMs) setTimeout(respond, options.delayMs);
    else respond();
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, requests, redirects };
}

function headerNames(headers: http.IncomingHttpHeaders): string[] {
  return Object.keys(headers).sort();
}

async function transportHeaderNames(server: LoopbackServer): Promise<string[]> {
  // Same cache mode as the GitLab chain, whose transport adds cache headers.
  const response = await fetch(`${server.origin}/transport-defaults`, {
    cache: "no-store",
  });
  await response.text();
  const request = server.requests.pop();
  return request ? headerNames(request.headers) : [];
}

describe("fetchWithTimeout redirect headers", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  });

  it("sends a GitLab request in every authentication mode to another origin without its credentials", async () => {
    const receiver = await startServer();
    const redirector = await startServer();
    const transportHeaders = await transportHeaderNames(receiver);
    redirector.redirects.set(
      "/api/v4/projects/1/releases",
      `${receiver.origin}/capture`,
    );

    const chain = buildGitlabAuthChain(GITLAB_HEADERS, GITLAB_AUTH);
    for (const candidate of chain) {
      const response = await fetchWithTimeout(
        `${redirector.origin}/api/v4/projects/1/releases`,
        candidate.options,
      );
      await consumeResponseWithTimeout(response, (result) => result.json());
      expect(response.status).toBe(200);
      expect(response.redirected).toBe(true);
      expect(response.url).toBe(`${receiver.origin}/capture`);
    }

    expect(chain.map(({ mode }) => mode)).toEqual([
      "token",
      "bearer",
      "basic",
      "none",
    ]);
    expect(redirector.requests[0]?.headers["private-token"]).toBe(
      GITLAB_AUTH.accessToken,
    );
    expect(receiver.requests).toHaveLength(chain.length);
    for (const { headers } of receiver.requests) {
      expect(headers["private-token"]).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers["if-none-match"]).toBeUndefined();
      expect(
        headerNames(headers).filter(
          (name) =>
            !transportHeaders.includes(name) &&
            !ALLOWED_CROSS_ORIGIN_HEADERS.includes(name),
        ),
      ).toEqual([]);
      expect(headers).toMatchObject({
        accept: "application/json",
        "accept-encoding": "identity",
        "accept-language": "de",
        "user-agent": "GitHubReleaseMonitorApp",
      });
    }
  });

  it("keeps every caller header on a redirect within the same origin", async () => {
    const server = await startServer();
    server.redirects.set(
      "/api/v4/projects/1/releases/permalink/latest",
      "/api/v4/projects/1/releases/v1.0.0",
    );
    const [tokenCandidate] = buildGitlabAuthChain(GITLAB_HEADERS, GITLAB_AUTH);

    const response = await fetchWithTimeout(
      `${server.origin}/api/v4/projects/1/releases/permalink/latest`,
      tokenCandidate.options,
    );
    await consumeResponseWithTimeout(response, (result) => result.json());

    expect(response.status).toBe(200);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(
      `${server.origin}/api/v4/projects/1/releases/v1.0.0`,
    );
    expect(server.requests.map(({ path }) => path)).toEqual([
      "/api/v4/projects/1/releases/permalink/latest",
      "/api/v4/projects/1/releases/v1.0.0",
    ]);
    expect(server.requests[1]?.headers).toMatchObject({
      "private-token": GITLAB_AUTH.accessToken,
      "if-none-match": '"cached-etag"',
      accept: "application/json",
      "user-agent": "GitHubReleaseMonitorApp",
    });
  });

  it("does not restore a dropped header when the chain returns to the first origin", async () => {
    const first = await startServer();
    const other = await startServer();
    first.redirects.set("/start", `${other.origin}/bounce`);
    other.redirects.set("/bounce", `${first.origin}/final`);
    const [tokenCandidate] = buildGitlabAuthChain(GITLAB_HEADERS, GITLAB_AUTH);

    const response = await fetchWithTimeout(
      `${first.origin}/start`,
      tokenCandidate.options,
    );
    await consumeResponseWithTimeout(response, (result) => result.json());

    expect(response.status).toBe(200);
    expect(response.url).toBe(`${first.origin}/final`);
    expect(first.requests.map(({ path }) => path)).toEqual([
      "/start",
      "/final",
    ]);
    expect(first.requests[0]?.headers["private-token"]).toBe(
      GITLAB_AUTH.accessToken,
    );
    const afterDrop = [...other.requests, ...first.requests.slice(1)];
    expect(afterDrop).toHaveLength(2);
    for (const { headers } of afterDrop) {
      expect(headers["private-token"]).toBeUndefined();
      expect(headers["if-none-match"]).toBeUndefined();
      expect(headers["user-agent"]).toBe("GitHubReleaseMonitorApp");
    }
  });

  it("follows up to 20 redirects and refuses the next one", async () => {
    const server = await startServer();
    for (let hop = 0; hop < 21; hop += 1) {
      server.redirects.set(`/hop/${hop}`, `/hop/${hop + 1}`);
    }

    const response = await fetchWithTimeout(`${server.origin}/hop/1`);
    await consumeResponseWithTimeout(response, (result) => result.json());
    expect(response.status).toBe(200);
    expect(response.url).toBe(`${server.origin}/hop/21`);
    expect(server.requests).toHaveLength(21);

    server.requests.length = 0;
    await expect(
      fetchWithTimeout(`${server.origin}/hop/0`),
    ).rejects.toBeInstanceOf(OutboundRedirectError);
    expect(server.requests).toHaveLength(21);
  });

  it.each([
    "ftp://127.0.0.1/release.json",
    "file:///etc/hostname",
    "http://[invalid",
  ])("refuses a redirect to %s", async (location) => {
    const server = await startServer();
    server.redirects.set("/start", location);

    await expect(
      fetchWithTimeout(`${server.origin}/start`, {
        headers: { "PRIVATE-TOKEN": GITLAB_AUTH.accessToken },
      }),
    ).rejects.toBeInstanceOf(OutboundRedirectError);
    expect(server.requests).toHaveLength(1);
  });

  it("does not hand GitLab credentials of the release fetch path to another origin", async () => {
    const receiver = await startServer({ status: 401 });
    const redirector = await startServer();
    redirector.redirects.set(
      "/api/v4/projects/group%2Frepo/releases?per_page=1",
      `${receiver.origin}/collect`,
    );

    const { response, mode } = await fetchJsonResponseWithRetryAuthChain(
      `${redirector.origin}/api/v4/projects/group%2Frepo/releases?per_page=1`,
      buildGitlabAuthChain(GITLAB_HEADERS, GITLAB_AUTH),
      { description: "GitLab releases", maxAttempts: 1 },
    );
    await discardResponseWithTimeout(response);

    expect(mode).toBe("none");
    expect(response.status).toBe(401);
    expect(
      redirector.requests.map(({ headers }) => [
        headers["private-token"],
        headers.authorization,
      ]),
    ).toEqual([
      [GITLAB_AUTH.accessToken, undefined],
      [undefined, `Bearer ${GITLAB_AUTH.accessToken}`],
      [
        undefined,
        `Basic ${Buffer.from("deploy-user:deploy-secret").toString("base64")}`,
      ],
      [undefined, undefined],
    ]);
    expect(
      receiver.requests.map(({ headers }) => [
        headers["private-token"],
        headers.authorization,
      ]),
    ).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("follows a raw UTF-8 redirect location to the same path as the platform", async () => {
    const server = await startServer();
    const start = "/api/v4/projects/1/releases/permalink/latest";
    const target = "/api/v4/projects/1/releases/v1-gr%C3%B6%C3%9Fer";
    server.redirects.set(
      start,
      Buffer.from("/api/v4/projects/1/releases/v1-größer").toString("latin1"),
    );

    const platformResponse = await fetch(`${server.origin}${start}`);
    await platformResponse.text();
    const response = await fetchWithTimeout(`${server.origin}${start}`);
    await consumeResponseWithTimeout(response, (result) => result.json());

    expect(server.requests.map(({ path }) => path)).toEqual([
      start,
      target,
      start,
      target,
    ]);
    expect(response.url).toBe(`${server.origin}${target}`);
    expect(response.url).toBe(platformResponse.url);
  });

  it("refuses a redirect target with credentials without requesting, retrying or logging it", async () => {
    const receiver = await startServer();
    const redirector = await startServer();
    const target = new URL(`${receiver.origin}/capture`);
    target.username = "location-user";
    target.password = "location-secret";
    redirector.redirects.set("/api/v4/projects/1/releases", target.href);
    const consoleSpies = (
      ["debug", "error", "info", "log", "warn"] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    const error = await fetchJsonResponseWithRetryAuthChain(
      `${redirector.origin}/api/v4/projects/1/releases`,
      buildGitlabAuthChain(GITLAB_HEADERS, GITLAB_AUTH),
      { description: "GitLab releases", initialDelayMs: 1 },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(OutboundRedirectError);
    expect(redirector.requests).toHaveLength(1);
    expect(receiver.requests).toHaveLength(0);
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) => inspect(argument))
      .join("\n");
    for (const text of [inspect(error), logged]) {
      expect(text).not.toContain("location-user");
      expect(text).not.toContain("location-secret");
      expect(text).not.toContain(target.host);
    }
  });

  it("keeps the timeout across the whole redirect chain", async () => {
    const receiver = await startServer({ delayMs: 200 });
    const redirector = await startServer({ delayMs: 200 });
    redirector.redirects.set("/start", `${receiver.origin}/slow`);

    await expect(
      fetchWithTimeout(`${redirector.origin}/start`, {}, 300),
    ).rejects.toBeInstanceOf(OutboundRequestTimeoutError);
  });

  it("returns the redirect itself to a caller that handles redirects", async () => {
    const receiver = await startServer();
    const redirector = await startServer();
    redirector.redirects.set("/start", `${receiver.origin}/capture`);

    const response = await fetchWithTimeout(`${redirector.origin}/start`, {
      headers: { "PRIVATE-TOKEN": GITLAB_AUTH.accessToken },
      redirect: "manual",
    });
    await discardResponseWithTimeout(response);

    expect(response.status).toBe(302);
    expect(response.redirected).toBe(false);
    expect(response.headers.get("location")).toBe(`${receiver.origin}/capture`);
    expect(receiver.requests).toHaveLength(0);
  });

  it("leaves a caller's redirect error mode to the platform", async () => {
    const receiver = await startServer();
    const redirector = await startServer();
    redirector.redirects.set("/start", `${receiver.origin}/capture`);

    await expect(
      fetchWithTimeout(`${redirector.origin}/start`, { redirect: "error" }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(receiver.requests).toHaveLength(0);
  });

  it("keeps the base-bound redirect rule of fetchWithAllowedRedirects", async () => {
    const receiver = await startServer();
    const forge = await startServer();
    forge.redirects.set("/code/api/v1/user", "/code/api/v1/users/me");
    forge.redirects.set("/code/api/v1/repos", `${receiver.origin}/code/repos`);
    const options = { headers: { Authorization: "token forgejo-secret" } };

    const response = await fetchWithAllowedRedirects(
      `${forge.origin}/code/api/v1/user`,
      options,
      `${forge.origin}/code`,
    );
    await consumeResponseWithTimeout(response, (result) => result.json());
    expect(response.status).toBe(200);
    expect(forge.requests[1]?.headers.authorization).toBe(
      "token forgejo-secret",
    );

    await expect(
      fetchWithAllowedRedirects(
        `${forge.origin}/code/api/v1/repos`,
        options,
        `${forge.origin}/code`,
      ),
    ).rejects.toThrow("Outbound redirect left the configured base URL.");
    expect(receiver.requests).toHaveLength(0);
  });
});

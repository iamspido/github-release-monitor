import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMocks = vi.hoisted(() => ({
  fetchJsonResponseWithRetry: vi.fn(),
  fetchWithRetry: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  getAllowedGitlabHosts: vi.fn(),
  getGitlabAccessTokensByHost: vi.fn(),
  getGitlabDeployTokensByHost: vi.fn(),
}));

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/releases/fetch", () => fetchMocks);

vi.mock("@/lib/repositories/providers", () => providerMocks);

vi.mock("@/lib/server-action-helpers", () => ({
  log: logMock,
  normalizeEnvToken(value: string | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    const unquoted =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1).trim()
        : trimmed;
    const compact = unquoted.replace(/\s+/g, "");
    return compact || null;
  },
}));

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: vi.fn(async () => body),
  } as unknown as Response;
}

function jsonResponse(status: number, data: unknown, jsonError?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: vi.fn(async () => {
      if (jsonError) throw jsonError;
      return data;
    }),
    text: vi.fn(async () => JSON.stringify(data)),
  } as unknown as Response;
}

function configureNoGitlabTokens() {
  providerMocks.getAllowedGitlabHosts.mockReturnValue(["gitlab.com"]);
  providerMocks.getGitlabAccessTokensByHost.mockReturnValue(new Map());
  providerMocks.getGitlabDeployTokensByHost.mockReturnValue(new Map());
}

describe("diagnostics/provider-checks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GITHUB_ACCESS_TOKEN;
    delete process.env.CODEBERG_ACCESS_TOKEN;
    configureNoGitlabTokens();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("getGitHubRateLimit", () => {
    it("returns the rate-limit payload and normalizes the optional token header", async () => {
      process.env.GITHUB_ACCESS_TOKEN = ' "ghp_\nabc" ';
      const data = {
        resources: {
          core: { limit: 5000, remaining: 4999, reset: 1, used: 1 },
          search: { limit: 30, remaining: 30, reset: 1, used: 0 },
          graphql: { limit: 5000, remaining: 5000, reset: 1, used: 0 },
        },
        rate: { limit: 5000, remaining: 4999, reset: 1, used: 1 },
      };
      fetchMocks.fetchJsonResponseWithRetry.mockResolvedValue({
        response: textResponse(200, JSON.stringify(data)),
        data,
      });
      const { getGitHubRateLimit } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitHubRateLimit()).resolves.toEqual({
        data,
        error: undefined,
      });
      expect(fetchMocks.fetchJsonResponseWithRetry).toHaveBeenCalledWith(
        "https://api.github.com/rate_limit",
        {
          headers: expect.objectContaining({
            Authorization: "token ghp_abc",
          }),
          cache: "no-store",
        },
        { description: "GitHub rate limit endpoint" },
      );
    });

    it.each([
      [401, "invalid_token"],
      [500, "api_error"],
    ] as const)("maps HTTP %s to %s", async (status, error) => {
      fetchMocks.fetchJsonResponseWithRetry.mockResolvedValue({
        response: textResponse(status, "failure"),
        data: null,
      });
      const { getGitHubRateLimit } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitHubRateLimit()).resolves.toEqual({
        data: null,
        error,
      });
    });

    it("maps thrown fetch failures to api_error", async () => {
      fetchMocks.fetchJsonResponseWithRetry.mockRejectedValue(
        new Error("network down"),
      );
      const { getGitHubRateLimit } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitHubRateLimit()).resolves.toEqual({
        data: null,
        error: "api_error",
      });
    });
  });

  describe("getGitlabTokenCheck", () => {
    it("returns not_set without configured GitLab tokens", async () => {
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "not_set",
      });
    });

    it.each([
      401, 403,
    ] as const)("treats deploy-token HTTP %s as valid with limited diagnostics", async (status) => {
      providerMocks.getGitlabDeployTokensByHost.mockReturnValue(
        new Map([
          ["gitlab.com", { username: "deploy-user", token: "deploy-token" }],
        ]),
      );
      fetchMocks.fetchWithRetry.mockResolvedValue(textResponse(status, ""));
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "valid",
        username: null,
        name: null,
        diagnosticsLimited: true,
      });
    });

    it("returns the deploy-token user payload when diagnostics are available", async () => {
      providerMocks.getGitlabDeployTokensByHost.mockReturnValue(
        new Map([
          ["gitlab.com", { username: "deploy-user", token: "deploy-token" }],
        ]),
      );
      fetchMocks.fetchWithRetry.mockResolvedValue(
        jsonResponse(200, { username: "deploy-user", name: "Deploy User" }),
      );
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "valid",
        username: "deploy-user",
        name: "Deploy User",
      });
    });

    it("treats invalid deploy-token JSON as valid with limited diagnostics", async () => {
      providerMocks.getGitlabDeployTokensByHost.mockReturnValue(
        new Map([
          ["gitlab.com", { username: "deploy-user", token: "deploy-token" }],
        ]),
      );
      fetchMocks.fetchWithRetry.mockResolvedValue(
        jsonResponse(200, null, new Error("invalid json")),
      );
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "valid",
        username: null,
        name: null,
        diagnosticsLimited: true,
      });
    });

    it("maps deploy-token server errors to api_error", async () => {
      providerMocks.getGitlabDeployTokensByHost.mockReturnValue(
        new Map([
          ["gitlab.com", { username: "deploy-user", token: "deploy-token" }],
        ]),
      );
      fetchMocks.fetchWithRetry.mockResolvedValue(
        textResponse(500, "gitlab failed"),
      );
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "api_error",
      });
    });

    it("falls back from PRIVATE-TOKEN to Bearer for access-token checks", async () => {
      providerMocks.getGitlabAccessTokensByHost.mockReturnValue(
        new Map([["gitlab.com", "access-token"]]),
      );
      fetchMocks.fetchWithRetry
        .mockResolvedValueOnce(textResponse(401, "bad private token"))
        .mockResolvedValueOnce(
          jsonResponse(200, { username: "token-user", name: "Token User" }),
        );
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "valid",
        username: "token-user",
        name: "Token User",
      });
      expect(fetchMocks.fetchWithRetry).toHaveBeenNthCalledWith(
        1,
        "https://gitlab.com/api/v4/user",
        {
          headers: expect.objectContaining({ "PRIVATE-TOKEN": "access-token" }),
          cache: "no-store",
        },
        { description: "GitLab user endpoint on gitlab.com (private-token)" },
      );
      expect(fetchMocks.fetchWithRetry).toHaveBeenNthCalledWith(
        2,
        "https://gitlab.com/api/v4/user",
        {
          headers: expect.objectContaining({
            Authorization: "Bearer access-token",
          }),
          cache: "no-store",
        },
        { description: "GitLab user endpoint on gitlab.com (bearer)" },
      );
    });

    it("returns invalid_token when both GitLab access-token schemes are rejected", async () => {
      providerMocks.getGitlabAccessTokensByHost.mockReturnValue(
        new Map([["gitlab.com", "access-token"]]),
      );
      fetchMocks.fetchWithRetry
        .mockResolvedValueOnce(textResponse(401, "bad private token"))
        .mockResolvedValueOnce(textResponse(401, "bad bearer token"));
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "invalid_token",
      });
    });

    it("maps invalid access-token JSON and thrown failures to api_error", async () => {
      providerMocks.getGitlabAccessTokensByHost.mockReturnValue(
        new Map([["gitlab.com", "access-token"]]),
      );
      fetchMocks.fetchWithRetry.mockResolvedValueOnce(
        jsonResponse(200, null, new Error("invalid json")),
      );
      const { getGitlabTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "api_error",
      });

      fetchMocks.fetchWithRetry.mockRejectedValueOnce(new Error("offline"));

      await expect(getGitlabTokenCheck()).resolves.toEqual({
        status: "api_error",
      });
    });
  });

  describe("getCodebergTokenCheck", () => {
    it("returns not_set without a Codeberg token", async () => {
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "not_set",
      });
    });

    it("returns the user payload for a valid token-schema response", async () => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry.mockResolvedValue(
        jsonResponse(200, { username: "forgejo", full_name: "Forge Jo" }),
      );
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "valid",
        login: "forgejo",
        fullName: "Forge Jo",
      });
      expect(fetchMocks.fetchWithRetry).toHaveBeenCalledWith(
        "https://codeberg.org/api/v1/user",
        {
          headers: expect.objectContaining({
            Authorization: "token codeberg-token",
          }),
          cache: "no-store",
        },
        { description: "Codeberg user endpoint (token)" },
      );
    });

    it("falls back to Bearer after a rejected token-schema response", async () => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry
        .mockResolvedValueOnce(textResponse(401, "bad token schema"))
        .mockResolvedValueOnce(
          jsonResponse(200, { login: "forgejo", full_name: null }),
        );
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "valid",
        login: "forgejo",
        fullName: null,
      });
      expect(fetchMocks.fetchWithRetry).toHaveBeenNthCalledWith(
        2,
        "https://codeberg.org/api/v1/user",
        {
          headers: expect.objectContaining({
            Authorization: "Bearer codeberg-token",
          }),
          cache: "no-store",
        },
        { description: "Codeberg user endpoint (bearer)" },
      );
    });

    it("treats read:user-only 403 responses as valid with limited diagnostics", async () => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry.mockResolvedValue(
        textResponse(403, "token scope should include [read:user]"),
      );
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "valid",
        login: null,
        fullName: null,
        diagnosticsLimited: true,
      });
    });

    it.each([
      ["invalid JSON", jsonResponse(200, null, new Error("invalid json"))],
      ["server error", textResponse(500, "server failed")],
    ])("maps %s to api_error", async (_label, response) => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry.mockResolvedValue(response);
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "api_error",
      });
    });

    it("returns invalid_token after both Codeberg token schemes return 401", async () => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry
        .mockResolvedValueOnce(textResponse(401, "bad token schema"))
        .mockResolvedValueOnce(textResponse(401, "bad bearer"));
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "invalid_token",
      });
    });

    it("maps thrown Codeberg token checks to api_error", async () => {
      process.env.CODEBERG_ACCESS_TOKEN = "codeberg-token";
      fetchMocks.fetchWithRetry.mockRejectedValue(new Error("offline"));
      const { getCodebergTokenCheck } = await import(
        "@/lib/diagnostics/provider-checks"
      );

      await expect(getCodebergTokenCheck()).resolves.toEqual({
        status: "api_error",
      });
    });
  });
});

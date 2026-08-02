import { mapWithConcurrency } from "@/lib/concurrency";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import {
  fetchJsonResponseWithRetry,
  fetchWithRetry,
  isRateLimitedResponse,
} from "@/lib/releases/fetch";
import {
  getAllowedForgejoBaseUrls,
  getAllowedGitlabHosts,
  getForgejoAccessTokensByBaseUrl,
  getGitlabAccessTokensByHost,
  getGitlabDeployTokensByHost,
} from "@/lib/repositories/providers";
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type {
  CodebergTokenCheckResult,
  ForgejoTokenCheckResult,
  GitlabTokenCheckResult,
  RateLimitResult,
} from "@/types";

export async function getGitHubRateLimit(): Promise<RateLimitResult> {
  const GITHUB_API_URL = "https://api.github.com/rate_limit";
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitHubReleaseMonitorApp",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const githubToken = normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN);
  if (githubToken) {
    headers.Authorization = `token ${githubToken}`;
  }

  try {
    const { response, data } = await fetchJsonResponseWithRetry<
      RateLimitResult["data"]
    >(
      GITHUB_API_URL,
      {
        headers,
        cache: "no-store",
      },
      { description: "GitHub rate limit endpoint" },
    );

    if (!response.ok) {
      await discardResponseWithTimeout(response);
      log.error(
        `GitHub API error for rate_limit: ${response.status} ${response.statusText}`,
      );
      if (response.status === 401) {
        return { data: null, error: "invalid_token" };
      }
      return { data: null, error: "api_error" };
    }
    return { data: data ?? null, error: undefined };
  } catch (error) {
    log.error("Failed to fetch GitHub rate limit:", error);
    return { data: null, error: "api_error" };
  }
}

type CodebergUserApi = {
  login?: string;
  username?: string;
  full_name?: string;
};

function parseForgejoUserIdentity(
  data: CodebergUserApi | undefined,
): { login: string; fullName: string | null } | null {
  const loginRaw =
    typeof data?.login === "string"
      ? data.login
      : typeof data?.username === "string"
        ? data.username
        : "";
  const login = loginRaw.trim();
  if (!login) return null;

  const fullNameRaw =
    typeof data?.full_name === "string" ? data.full_name.trim() : "";
  return { login, fullName: fullNameRaw || null };
}

type GitlabUserApi = {
  username?: string;
  name?: string;
};

export async function getGitlabTokenCheck(): Promise<GitlabTokenCheckResult> {
  const accessTokensByHost = getGitlabAccessTokensByHost();
  const deployTokensByHost = getGitlabDeployTokensByHost();
  const allowedHosts = getAllowedGitlabHosts();
  const hostsWithToken = allowedHosts.filter(
    (host) => accessTokensByHost.has(host) || deployTokensByHost.has(host),
  );
  if (hostsWithToken.length === 0) return { status: "not_set" };

  const hostToCheck = hostsWithToken.includes("gitlab.com")
    ? "gitlab.com"
    : hostsWithToken[0];
  const accessToken = accessTokensByHost.get(hostToCheck) ?? null;
  const deployToken = deployTokensByHost.get(hostToCheck) ?? null;
  if (!accessToken && !deployToken) return { status: "not_set" };

  const authKind = accessToken ? "access token" : "deploy token";
  log.info(`Validating GitLab ${authKind} for host ${hostToCheck}.`);

  const GITLAB_USER_URL = `https://${hostToCheck}/api/v4/user`;
  const baseHeaders: HeadersInit = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  if (!accessToken && deployToken) {
    const basicAuth = Buffer.from(
      `${deployToken.username}:${deployToken.token}`,
    ).toString("base64");

    try {
      const response = await fetchWithRetry(
        GITLAB_USER_URL,
        {
          headers: { ...baseHeaders, Authorization: `Basic ${basicAuth}` },
          cache: "no-store",
        },
        {
          description: `GitLab user endpoint on ${hostToCheck} (basic)`,
        },
      );

      // Deploy tokens are usually not accepted on `/user` even when valid for repo access.
      if (response.status === 401 || response.status === 403) {
        await discardResponseWithTimeout(response);
        return {
          status: "valid",
          username: null,
          name: null,
          diagnosticsLimited: true,
        };
      }

      if (!response.ok) {
        let bodyText: string | undefined;
        try {
          bodyText = await consumeResponseWithTimeout(response, (result) =>
            result.text(),
          );
        } catch {
          bodyText = undefined;
        }

        log.error(
          `GitLab deploy token check failed (basic): ${response.status} ${response.statusText}`,
          bodyText ? { bodyText } : undefined,
        );
        return { status: "api_error" };
      }

      let data: GitlabUserApi | undefined;
      try {
        data = await consumeResponseWithTimeout(
          response,
          async (result) => (await result.json()) as GitlabUserApi,
        );
      } catch {
        return {
          status: "valid",
          username: null,
          name: null,
          diagnosticsLimited: true,
        };
      }

      const username =
        typeof data?.username === "string" ? data.username : null;
      const name = typeof data?.name === "string" ? data.name : null;
      return { status: "valid", username, name };
    } catch (error) {
      log.error("Failed to validate GitLab deploy token:", error);
      return { status: "api_error" };
    }
  }

  if (!accessToken) return { status: "not_set" };

  try {
    const attempts: Array<{
      scheme: "private-token" | "bearer";
      headers: HeadersInit;
    }> = [
      {
        scheme: "private-token",
        headers: { ...baseHeaders, "PRIVATE-TOKEN": accessToken },
      },
      {
        scheme: "bearer",
        headers: { ...baseHeaders, Authorization: `Bearer ${accessToken}` },
      },
    ];

    for (const attempt of attempts) {
      const response = await fetchWithRetry(
        GITLAB_USER_URL,
        { headers: attempt.headers, cache: "no-store" },
        {
          description: `GitLab user endpoint on ${hostToCheck} (${attempt.scheme})`,
        },
      );

      if (!response.ok) {
        if (response.status === 401) {
          await discardResponseWithTimeout(response);
          continue;
        }

        let bodyText: string | undefined;
        try {
          bodyText = await consumeResponseWithTimeout(response, (result) =>
            result.text(),
          );
        } catch {
          bodyText = undefined;
        }

        log.error(
          `GitLab token check failed (${attempt.scheme}): ${response.status} ${response.statusText}`,
          bodyText ? { bodyText } : undefined,
        );
        return { status: "api_error" };
      }

      let data: GitlabUserApi | undefined;
      try {
        data = await consumeResponseWithTimeout(
          response,
          async (result) => (await result.json()) as GitlabUserApi,
        );
      } catch (error) {
        log.error(
          `GitLab token check returned invalid JSON (${attempt.scheme}).`,
          error,
        );
        return { status: "api_error" };
      }

      const username =
        typeof data?.username === "string" ? data.username : null;
      const name = typeof data?.name === "string" ? data.name : null;

      return { status: "valid", username, name };
    }

    return { status: "invalid_token" };
  } catch (error) {
    log.error("Failed to validate GitLab token:", error);
    return { status: "api_error" };
  }
}

export async function getCodebergTokenCheck(): Promise<CodebergTokenCheckResult> {
  const token = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);
  if (!token) return { status: "not_set" };

  log.info("Validating Codeberg token.");

  const CODEBERG_USER_URL = "https://codeberg.org/api/v1/user";
  const baseHeaders: HeadersInit = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  try {
    const attempts: Array<{
      scheme: "token" | "bearer";
      headers: HeadersInit;
    }> = [
      {
        scheme: "token",
        headers: { ...baseHeaders, Authorization: `token ${token}` },
      },
      {
        scheme: "bearer",
        headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
      },
    ];

    for (const attempt of attempts) {
      const response = await fetchWithRetry(
        CODEBERG_USER_URL,
        { headers: attempt.headers, cache: "no-store" },
        { description: `Codeberg user endpoint (${attempt.scheme})` },
      );

      if (!response.ok) {
        let bodyText: string | undefined;
        try {
          bodyText = await consumeResponseWithTimeout(response, (result) =>
            result.text(),
          );
        } catch {
          bodyText = undefined;
        }

        if (response.status === 401) {
          continue;
        }

        // Codeberg scopes: `/api/v1/user` requires `read:user`. A token without this scope
        // can still be valid and work for repository access (e.g. `read:repository`).
        if (response.status === 403 && bodyText?.includes("[read:user]")) {
          log.info(
            `Codeberg token is valid but missing optional read:user scope (${attempt.scheme}).`,
          );
          return {
            status: "valid",
            login: null,
            fullName: null,
            diagnosticsLimited: true,
          };
        }

        log.error(
          `Codeberg token check failed (${attempt.scheme}): ${response.status} ${response.statusText}`,
          bodyText ? { bodyText } : undefined,
        );
        return { status: "api_error" };
      }

      let data: CodebergUserApi | undefined;
      try {
        data = await consumeResponseWithTimeout(
          response,
          async (result) => (await result.json()) as CodebergUserApi,
        );
      } catch (error) {
        log.error(
          `Codeberg token check returned invalid JSON (${attempt.scheme}).`,
          error,
        );
        return { status: "api_error" };
      }

      const loginRaw =
        typeof data?.login === "string"
          ? data.login
          : typeof data?.username === "string"
            ? data.username
            : null;

      const fullName =
        typeof data?.full_name === "string" ? data.full_name : null;

      return { status: "valid", login: loginRaw, fullName };
    }

    return { status: "invalid_token" };
  } catch (error) {
    log.error("Failed to validate Codeberg token:", error);
    return { status: "api_error" };
  }
}

async function checkForgejoToken(
  baseUrl: string,
  token: string,
): Promise<ForgejoTokenCheckResult> {
  const userUrl = `${baseUrl}/api/v1/user`;
  const baseHeaders: HeadersInit = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  try {
    const attempts: Array<{
      scheme: "token" | "bearer";
      headers: HeadersInit;
    }> = [
      {
        scheme: "token",
        headers: { ...baseHeaders, Authorization: `token ${token}` },
      },
      {
        scheme: "bearer",
        headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
      },
    ];

    for (const attempt of attempts) {
      const response = await fetchWithRetry(
        userUrl,
        {
          headers: attempt.headers,
          cache: "no-store",
        },
        {
          description: `Forgejo user endpoint on ${baseUrl} (${attempt.scheme})`,
          allowedRedirectBaseUrl: baseUrl,
        },
      );

      let bodyText: string | undefined;
      if (!response.ok) {
        try {
          bodyText = await consumeResponseWithTimeout(response, (result) =>
            result.text(),
          );
        } catch {
          bodyText = undefined;
        }

        if (isRateLimitedResponse(response)) {
          log.error(
            `Forgejo token check was rate limited on ${baseUrl} (${attempt.scheme}): ${response.status} ${response.statusText}`,
          );
          return { baseUrl, status: "api_error" };
        }

        if (response.status === 403 && /read:user/i.test(bodyText ?? "")) {
          return {
            baseUrl,
            status: "valid",
            login: null,
            fullName: null,
            diagnosticsLimited: true,
          };
        }
        if (response.status === 401 || response.status === 403) continue;
        log.error(
          `Forgejo token check failed on ${baseUrl} (${attempt.scheme}): ${response.status} ${response.statusText}`,
        );
        return { baseUrl, status: "api_error" };
      }

      let data: CodebergUserApi | undefined;
      try {
        data = await consumeResponseWithTimeout(
          response,
          async (result) => (await result.json()) as CodebergUserApi,
        );
      } catch (error) {
        log.error(
          `Forgejo token check returned invalid JSON on ${baseUrl} (${attempt.scheme}).`,
          error,
        );
        return { baseUrl, status: "api_error" };
      }

      const identity = parseForgejoUserIdentity(data);
      if (!identity) {
        log.error(
          `Forgejo token check returned an invalid user payload on ${baseUrl} (${attempt.scheme}).`,
        );
        return { baseUrl, status: "api_error" };
      }
      return { baseUrl, status: "valid", ...identity };
    }

    return { baseUrl, status: "invalid_token" };
  } catch (error) {
    log.error(`Failed to validate Forgejo token on ${baseUrl}:`, error);
    return { baseUrl, status: "api_error" };
  }
}

async function checkForgejoConnectivity(
  baseUrl: string,
): Promise<ForgejoTokenCheckResult> {
  try {
    const response = await fetchWithRetry(
      `${baseUrl}/api/v1/user`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "GitHubReleaseMonitorApp",
        },
        cache: "no-store",
      },
      {
        description: `Forgejo user endpoint on ${baseUrl} (anonymous)`,
        allowedRedirectBaseUrl: baseUrl,
      },
    );
    const status = response.status;
    const statusText = response.statusText;
    if (isRateLimitedResponse(response)) {
      await discardResponseWithTimeout(response);
      log.error(
        `Forgejo connectivity check was rate limited on ${baseUrl}: ${status} ${statusText}`,
      );
      return { baseUrl, status: "not_set", connectivityError: true };
    }
    if (status === 401 || status === 403) {
      await discardResponseWithTimeout(response);
      return { baseUrl, status: "not_set" };
    }
    if (response.ok) {
      let data: CodebergUserApi | undefined;
      try {
        data = await consumeResponseWithTimeout(
          response,
          async (result) => (await result.json()) as CodebergUserApi,
        );
      } catch (error) {
        log.error(
          `Forgejo connectivity check returned invalid JSON on ${baseUrl}.`,
          error,
        );
        return { baseUrl, status: "not_set", connectivityError: true };
      }
      if (parseForgejoUserIdentity(data)) {
        return { baseUrl, status: "not_set" };
      }
      log.error(
        `Forgejo connectivity check returned an invalid user payload on ${baseUrl}.`,
      );
      return { baseUrl, status: "not_set", connectivityError: true };
    }

    await discardResponseWithTimeout(response);

    log.error(
      `Forgejo connectivity check failed on ${baseUrl}: ${status} ${statusText}`,
    );
    return { baseUrl, status: "not_set", connectivityError: true };
  } catch (error) {
    log.error(`Failed to check Forgejo connectivity on ${baseUrl}:`, error);
    return { baseUrl, status: "not_set", connectivityError: true };
  }
}

export async function getForgejoTokenChecks(): Promise<
  ForgejoTokenCheckResult[]
> {
  const baseUrls = getAllowedForgejoBaseUrls();
  const tokens = getForgejoAccessTokensByBaseUrl();
  return mapWithConcurrency(baseUrls, 4, async (baseUrl) => {
    const token = tokens.get(baseUrl);
    if (!token) return checkForgejoConnectivity(baseUrl);
    log.info(`Validating Forgejo token for ${baseUrl}.`);
    return checkForgejoToken(baseUrl, token);
  });
}

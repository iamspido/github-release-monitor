import {
  fetchJsonResponseWithRetry,
  fetchWithRetry,
} from "@/lib/releases/fetch";
import {
  getAllowedGitlabHosts,
  getGitlabAccessTokensByHost,
  getGitlabDeployTokensByHost,
} from "@/lib/repositories/providers";
import { log, normalizeEnvToken } from "@/lib/server-action-helpers";
import type {
  CodebergTokenCheckResult,
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
          bodyText = await response.text();
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
        data = (await response.json()) as GitlabUserApi;
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
          continue;
        }

        let bodyText: string | undefined;
        try {
          bodyText = await response.text();
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
        data = (await response.json()) as GitlabUserApi;
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
          bodyText = await response.text();
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
        data = (await response.json()) as CodebergUserApi;
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

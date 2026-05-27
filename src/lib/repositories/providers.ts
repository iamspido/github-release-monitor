import { log, normalizeEnvToken } from "@/lib/server-action-helpers";

export type RepoProvider = "github" | "codeberg" | "gitlab";

export type ParsedRepoUrl = {
  provider: RepoProvider;
  providerHost?: string;
  owner: string;
  repo: string;
  id: string;
  canonicalRepoUrl: string;
};

export function normalizeGitlabHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("://")) return null;
  if (host.includes("/")) return null;
  if (host.includes(":")) return null;
  if (host.includes("?") || host.includes("#")) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith(".") || host.endsWith(".")) return null;
  return host;
}

export function getAllowedGitlabHosts(): string[] {
  const hosts = new Set<string>(["gitlab.com"]);
  const raw = process.env.GITLAB_ADDITIONAL_HOSTS;
  if (!raw) return [...hosts];

  for (const entry of raw.split(",")) {
    const normalized = normalizeGitlabHost(entry);
    if (!normalized) {
      log.warn(
        `Ignoring invalid GITLAB_ADDITIONAL_HOSTS entry: '${entry.trim()}'`,
      );
      continue;
    }
    hosts.add(normalized);
  }

  return [...hosts];
}

export function getGitlabAccessTokensByHost(): Map<string, string> {
  const tokensByHost = new Map<string, string>();
  const raw = process.env.GITLAB_ACCESS_TOKENS;
  if (!raw) return tokensByHost;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_ACCESS_TOKENS entry (missing host=token): '${trimmed}'`,
      );
      continue;
    }

    const rawHost = trimmed.slice(0, separatorIndex);
    const rawToken = trimmed.slice(separatorIndex + 1);
    const host = normalizeGitlabHost(rawHost);
    const token = normalizeEnvToken(rawToken);
    if (!host || !token) {
      log.warn(
        `Ignoring invalid GITLAB_ACCESS_TOKENS entry: '${trimmed.slice(0, Math.min(trimmed.length, 48))}${trimmed.length > 48 ? "..." : ""}'`,
      );
      continue;
    }

    tokensByHost.set(host, token);
  }

  return tokensByHost;
}

export type GitlabDeployToken = {
  username: string;
  token: string;
};

function normalizeGitlabDeployUsername(value: string): string | null {
  const username = value.trim();
  if (!username) return null;
  if (username.includes(",")) return null;
  if (/\s/.test(username)) return null;
  return username;
}

export function getGitlabDeployTokensByHost(): Map<string, GitlabDeployToken> {
  const tokensByHost = new Map<string, GitlabDeployToken>();
  const raw = process.env.GITLAB_DEPLOY_TOKENS;
  if (!raw) return tokensByHost;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry (missing host=username:token): '${trimmed}'`,
      );
      continue;
    }

    const rawHost = trimmed.slice(0, separatorIndex);
    const rawCredentials = trimmed.slice(separatorIndex + 1);
    const credentialSeparatorIndex = rawCredentials.indexOf(":");
    if (credentialSeparatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry (missing username:token): '${trimmed.slice(0, Math.min(trimmed.length, 48))}${trimmed.length > 48 ? "..." : ""}'`,
      );
      continue;
    }

    const rawUsername = rawCredentials.slice(0, credentialSeparatorIndex);
    const rawToken = rawCredentials.slice(credentialSeparatorIndex + 1);
    const host = normalizeGitlabHost(rawHost);
    const username = normalizeGitlabDeployUsername(rawUsername);
    const token = normalizeEnvToken(rawToken);
    if (!host || !username || !token) {
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry: '${trimmed.slice(0, Math.min(trimmed.length, 48))}${trimmed.length > 48 ? "..." : ""}'`,
      );
      continue;
    }

    tokensByHost.set(host, { username, token });
  }

  return tokensByHost;
}

export type GitlabAuthConfig = {
  accessToken: string | null;
  deployToken: GitlabDeployToken | null;
};

export function getGitlabAuthForHost(host: string): GitlabAuthConfig | null {
  const normalizedHost = normalizeGitlabHost(host);
  if (!normalizedHost) return null;

  const accessToken = getGitlabAccessTokensByHost().get(normalizedHost) ?? null;
  const deployToken = getGitlabDeployTokensByHost().get(normalizedHost) ?? null;

  if (!accessToken && !deployToken) return null;
  return { accessToken, deployToken };
}

export function hasAnyGitlabTokenForAllowedHosts(): boolean {
  const accessTokensByHost = getGitlabAccessTokensByHost();
  const deployTokensByHost = getGitlabDeployTokensByHost();
  return getAllowedGitlabHosts().some(
    (host) => accessTokensByHost.has(host) || deployTokensByHost.has(host),
  );
}

export function normalizeRepoName(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function parseGitHubUrl(url: string): ParsedRepoUrl | null {
  try {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;
    const urlObj = new URL(trimmedUrl);
    if (urlObj.hostname !== "github.com") return null;

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      const [owner, repoRaw] = pathParts;
      const repo = normalizeRepoName(repoRaw);
      return {
        provider: "github",
        owner,
        repo,
        id: `github:${owner}/${repo}`.toLowerCase(),
        canonicalRepoUrl: `https://github.com/${owner}/${repo}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseCodebergUrl(url: string): ParsedRepoUrl | null {
  try {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;
    const urlObj = new URL(trimmedUrl);
    if (urlObj.hostname !== "codeberg.org") return null;

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      // Support both web URLs (`/owner/repo`) and API URLs (`/api/v1/repos/owner/repo`).
      if (pathParts[0] === "api" && pathParts[1] === "v1") {
        const reposIndex = pathParts.indexOf("repos");
        if (reposIndex !== -1 && pathParts.length >= reposIndex + 3) {
          const owner = pathParts[reposIndex + 1];
          const repoRaw = pathParts[reposIndex + 2];
          if (!owner || !repoRaw) return null;
          const repo = normalizeRepoName(repoRaw);
          return {
            provider: "codeberg",
            owner,
            repo,
            id: `codeberg:${owner}/${repo}`.toLowerCase(),
            canonicalRepoUrl: `https://codeberg.org/${owner}/${repo}`,
          };
        }
      }

      const [owner, repoRaw] = pathParts;
      const repo = normalizeRepoName(repoRaw);
      return {
        provider: "codeberg",
        owner,
        repo,
        id: `codeberg:${owner}/${repo}`.toLowerCase(),
        canonicalRepoUrl: `https://codeberg.org/${owner}/${repo}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseGitLabUrl(url: string): ParsedRepoUrl | null {
  try {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;
    const urlObj = new URL(trimmedUrl);
    const host = urlObj.hostname.toLowerCase();
    if (!getAllowedGitlabHosts().includes(host)) return null;

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      // Support API URLs (`/api/v4/projects/:id`), where :id is URL-encoded.
      if (pathParts[0] === "api" && pathParts[1] === "v4") {
        const projectsIndex = pathParts.indexOf("projects");
        if (projectsIndex !== -1 && pathParts.length > projectsIndex + 1) {
          try {
            const encodedPath = pathParts[projectsIndex + 1];
            const decodedPath = decodeURIComponent(encodedPath);
            const decodedParts = decodedPath.split("/").filter(Boolean);
            if (decodedParts.length >= 2) {
              const repoRaw = decodedParts.at(-1);
              if (!repoRaw) return null;
              const repo = normalizeRepoName(repoRaw);
              const owner = decodedParts.slice(0, -1).join("/");
              if (!owner || !repo) return null;
              return {
                provider: "gitlab",
                providerHost: host,
                owner,
                repo,
                id: `gitlab:${host}/${owner}/${repo}`.toLowerCase(),
                canonicalRepoUrl: `https://${host}/${owner}/${repo}`,
              };
            }
          } catch {
            return null;
          }
        }
      }

      // Support web URLs, including nested groups and `/-/` URLs.
      const dashIndex = pathParts.indexOf("-");
      const projectParts =
        dashIndex === -1 ? pathParts : pathParts.slice(0, dashIndex);
      if (projectParts.length >= 2) {
        const repoRaw = projectParts.at(-1);
        if (!repoRaw) return null;
        const repo = normalizeRepoName(repoRaw);
        const owner = projectParts.slice(0, -1).join("/");
        if (!owner || !repo) return null;
        return {
          provider: "gitlab",
          providerHost: host,
          owner,
          repo,
          id: `gitlab:${host}/${owner}/${repo}`.toLowerCase(),
          canonicalRepoUrl: `https://${host}/${owner}/${repo}`,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function parseSupportedRepoUrl(url: string): ParsedRepoUrl | null {
  return parseGitHubUrl(url) ?? parseCodebergUrl(url) ?? parseGitLabUrl(url);
}

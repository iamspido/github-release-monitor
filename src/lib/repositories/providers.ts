import { log, normalizeEnvToken } from "@/lib/server-action-helpers";

export type RepoProvider = "github" | "codeberg" | "forgejo" | "gitlab";

export type ParsedRepoUrl = {
  provider: RepoProvider;
  providerHost?: string;
  providerBaseUrl?: string;
  owner: string;
  repo: string;
  id: string;
  canonicalRepoUrl: string;
};

function hasUrlUserInfo(value: string): boolean {
  const schemeSeparator = value.indexOf("://");
  if (schemeSeparator === -1) return false;
  const authority = value.slice(schemeSeparator + 3).split("/", 1)[0];
  return authority.includes("@");
}

function hasUnsafeRawUrlCharacters(value: string): boolean {
  // WHATWG URL parsing treats backslashes as path separators for HTTP(S) and
  // silently strips some ASCII control characters. Reject those inputs before
  // parsing so configured base-path boundaries cannot change implicitly.
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\" || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function canonicalizeForgejoPathname(pathname: string): string | null {
  if (/%(?![0-9a-f]{2})/i.test(pathname)) return null;
  if (/%(?:2f|5c)/i.test(pathname)) return null;

  const idSafePathname = pathname.replace(
    /\[|\]|\|/g,
    (character) =>
      `%${character.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}`,
  );
  const canonicalPathname = idSafePathname.replace(
    /%([0-9a-f]{2})/gi,
    (encoded, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      // Decode URL-unreserved characters except dots. Encoded dots stay
      // encoded so canonicalization cannot create traversal segments.
      return /^[a-z0-9_~-]$/i.test(character)
        ? character
        : encoded.toUpperCase();
    },
  );
  return canonicalPathname
    .split("/")
    .map((segment) => {
      const decodedDots = segment.replace(/%2E/gi, ".");
      return decodedDots === "." || decodedDots === ".."
        ? segment
        : decodedDots;
    })
    .join("/");
}

export function normalizeForgejoBaseUrl(value: string): string | null {
  try {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    if (hasUnsafeRawUrlCharacters(trimmed)) return null;
    // URL drops empty query/fragment delimiters, so reject them before parsing.
    if (trimmed.includes("?") || trimmed.includes("#")) return null;
    if (hasUrlUserInfo(trimmed)) return null;

    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.hostname.endsWith(".")) return null;

    const pathname = url.pathname.replace(/\/+$/, "");
    // Encoded path separators make the configured base-path boundary
    // ambiguous after proxy/server decoding. Other valid URL path characters
    // remain supported and are preserved in the persisted repository ID.
    const canonicalPathname = canonicalizeForgejoPathname(pathname);
    if (canonicalPathname === null) return null;
    url.pathname = canonicalPathname || "/";
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

function getForgejoInstanceKey(baseUrl: string): string {
  const url = new URL(baseUrl);
  // Authorities are case-insensitive, URL paths are not. The scheme is
  // intentionally omitted so HTTP and HTTPS cannot configure the same
  // authority/base-path combination twice.
  return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
}

export function getAllowedForgejoBaseUrls(): string[] {
  const raw = process.env.FORGEJO_ADDITIONAL_BASE_URLS;
  if (!raw) return [];

  const baseUrls: string[] = [];
  const instanceKeys = new Set<string>();
  for (const [index, entry] of raw.split(",").entries()) {
    const baseUrl = normalizeForgejoBaseUrl(entry);
    if (!baseUrl) {
      log.warn(
        `Ignoring invalid FORGEJO_ADDITIONAL_BASE_URLS entry ${index + 1}.`,
      );
      continue;
    }
    if (new URL(baseUrl).hostname === "codeberg.org") {
      log.warn(
        `Ignoring reserved Codeberg URL in FORGEJO_ADDITIONAL_BASE_URLS entry ${index + 1}.`,
      );
      continue;
    }

    const instanceKey = getForgejoInstanceKey(baseUrl);
    if (instanceKeys.has(instanceKey)) {
      log.warn(
        `Ignoring duplicate Forgejo instance in FORGEJO_ADDITIONAL_BASE_URLS entry ${index + 1}.`,
      );
      continue;
    }
    instanceKeys.add(instanceKey);
    baseUrls.push(baseUrl);
  }

  return baseUrls;
}

export function getForgejoAccessTokensByBaseUrl(): Map<string, string> {
  const tokensByBaseUrl = new Map<string, string>();
  const allowedBaseUrls = new Set(getAllowedForgejoBaseUrls());
  const raw = process.env.FORGEJO_ACCESS_TOKENS;
  if (!raw) return tokensByBaseUrl;

  for (const [index, entry] of raw.split(",").entries()) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndexes = [...trimmed.matchAll(/=/g)].map(
      (match) => match.index,
    );
    if (separatorIndexes.length === 0) {
      log.warn(
        `Ignoring invalid FORGEJO_ACCESS_TOKENS entry ${index + 1}: missing base-url=token.`,
      );
      continue;
    }

    const candidates: Array<{
      baseUrl: string;
      separatorIndex: number;
    }> = [];
    for (const separatorIndex of separatorIndexes) {
      const candidateBaseUrl = normalizeForgejoBaseUrl(
        trimmed.slice(0, separatorIndex),
      );
      if (!candidateBaseUrl || !allowedBaseUrls.has(candidateBaseUrl)) continue;
      candidates.push({
        baseUrl: candidateBaseUrl,
        separatorIndex,
      });
    }

    // A configured base path may itself contain '='. Prefer the longest exact
    // configured base URL so `/code=hosting=token` cannot be assigned to an
    // also configured `/code` instance.
    candidates.sort(
      (a, b) =>
        b.baseUrl.length - a.baseUrl.length ||
        b.separatorIndex - a.separatorIndex,
    );
    const selectedCandidate = candidates[0];
    const baseUrl = selectedCandidate?.baseUrl ?? null;
    const token = selectedCandidate
      ? normalizeEnvToken(trimmed.slice(selectedCandidate.separatorIndex + 1))
      : null;

    if (!baseUrl || !token) {
      log.warn(
        `Ignoring invalid or unconfigured FORGEJO_ACCESS_TOKENS entry ${index + 1}.`,
      );
      continue;
    }
    if (tokensByBaseUrl.has(baseUrl)) {
      log.warn(`Ignoring duplicate FORGEJO_ACCESS_TOKENS entry ${index + 1}.`);
      continue;
    }
    tokensByBaseUrl.set(baseUrl, token);
  }

  return tokensByBaseUrl;
}

export function getForgejoAccessTokenForBaseUrl(value: string): string | null {
  const baseUrl = normalizeForgejoBaseUrl(value);
  if (!baseUrl) return null;
  return getForgejoAccessTokensByBaseUrl().get(baseUrl) ?? null;
}

export function hasAnyForgejoToken(): boolean {
  return getForgejoAccessTokensByBaseUrl().size > 0;
}

export function buildForgejoRepoId(
  baseUrl: string,
  owner: string,
  repo: string,
): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/^\/+|\/+$/g, "");
  const instancePath = [url.host.toLowerCase(), basePath]
    .filter(Boolean)
    .join("/");
  return `forgejo:${instancePath}/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

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

  for (const [index, entry] of raw.split(",").entries()) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_ACCESS_TOKENS entry ${index + 1}: missing host=token.`,
      );
      continue;
    }

    const rawHost = trimmed.slice(0, separatorIndex);
    const rawToken = trimmed.slice(separatorIndex + 1);
    const host = normalizeGitlabHost(rawHost);
    const token = normalizeEnvToken(rawToken);
    if (!host || !token) {
      const hostDescription = host ?? "invalid-host";
      log.warn(
        `Ignoring invalid GITLAB_ACCESS_TOKENS entry ${index + 1} for host '${hostDescription}'.`,
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

  for (const [index, entry] of raw.split(",").entries()) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry ${index + 1}: missing host=username:token.`,
      );
      continue;
    }

    const rawHost = trimmed.slice(0, separatorIndex);
    const rawCredentials = trimmed.slice(separatorIndex + 1);
    const credentialSeparatorIndex = rawCredentials.indexOf(":");
    if (credentialSeparatorIndex <= 0) {
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry ${index + 1}: missing username:token.`,
      );
      continue;
    }

    const rawUsername = rawCredentials.slice(0, credentialSeparatorIndex);
    const rawToken = rawCredentials.slice(credentialSeparatorIndex + 1);
    const host = normalizeGitlabHost(rawHost);
    const username = normalizeGitlabDeployUsername(rawUsername);
    const token = normalizeEnvToken(rawToken);
    if (!host || !username || !token) {
      const hostDescription = host ?? "invalid-host";
      log.warn(
        `Ignoring invalid GITLAB_DEPLOY_TOKENS entry ${index + 1} for host '${hostDescription}'.`,
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

function decodeForgejoPathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return /^[a-z0-9._-]+$/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseForgejoUrl(url: string): ParsedRepoUrl | null {
  try {
    const trimmed = url.trim();
    if (hasUnsafeRawUrlCharacters(trimmed)) return null;
    if (hasUrlUserInfo(trimmed)) return null;
    const urlObj = new URL(trimmed);
    if (urlObj.username || urlObj.password) return null;
    const canonicalPathname = canonicalizeForgejoPathname(urlObj.pathname);
    if (canonicalPathname === null) return null;
    const baseUrl = [...getAllowedForgejoBaseUrls()]
      .sort((a, b) => new URL(b).pathname.length - new URL(a).pathname.length)
      .find((candidate) => {
        const candidateUrl = new URL(candidate);
        if (urlObj.origin !== candidateUrl.origin) return false;
        const basePath = candidateUrl.pathname.replace(/\/+$/, "");
        return (
          basePath === "" ||
          canonicalPathname === basePath ||
          canonicalPathname.startsWith(`${basePath}/`)
        );
      });
    if (!baseUrl) return null;

    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    const relativePath = canonicalPathname.slice(basePath.length);
    const pathParts = relativePath.split("/").filter(Boolean);
    let ownerRaw: string | undefined;
    let repoRaw: string | undefined;

    if (
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "repos"
    ) {
      ownerRaw = pathParts[3];
      repoRaw = pathParts[4];
    } else if (pathParts[0] === "api" && pathParts[1] === "v1") {
      return null;
    } else {
      [ownerRaw, repoRaw] = pathParts;
    }

    if (!ownerRaw || !repoRaw) return null;
    const owner = decodeForgejoPathSegment(ownerRaw);
    const decodedRepo = decodeForgejoPathSegment(repoRaw);
    if (!owner || !decodedRepo) return null;
    const repo = normalizeRepoName(decodedRepo);
    if (!repo) return null;

    return {
      provider: "forgejo",
      providerHost: base.host,
      providerBaseUrl: baseUrl,
      owner,
      repo,
      id: buildForgejoRepoId(baseUrl, owner, repo),
      canonicalRepoUrl: `${baseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    };
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
  return (
    parseGitHubUrl(url) ??
    parseCodebergUrl(url) ??
    parseForgejoUrl(url) ??
    parseGitLabUrl(url)
  );
}

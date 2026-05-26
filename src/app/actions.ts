"use server";

import crypto from "node:crypto";
import { inflateSync } from "node:zlib";
import { revalidatePath, unstable_cache, updateTag } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { parse as parseYaml } from "yaml";
import { canPerformRestrictedAction } from "@/lib/auth-access";
import { trackBackgroundTask } from "@/lib/background-tasks";
import { sendTestEmail } from "@/lib/email";
import { isRetryableFetchError } from "@/lib/fetch-retry";
import { getJobStatus, type JobStatus, setJobStatus } from "@/lib/job-store";
import { logger } from "@/lib/logger";
import {
  sendNotification,
  sendTestAppriseNotification,
} from "@/lib/notifications";
import {
  filterRepositoriesDueForBackgroundCheck,
  getEffectiveCacheIntervalMinutes,
  normalizeBackgroundCheckCron,
  normalizeCacheInterval,
  normalizeRefreshInterval,
} from "@/lib/repository-schedule";
import { getRepositories, saveRepositories } from "@/lib/repository-storage";
import { getSettings } from "@/lib/settings-storage";
import { getSystemStatus, updateSystemStatus } from "@/lib/system-status";
import { scheduleTask } from "@/lib/task-scheduler";
import { runApplicationUpdateCheck } from "@/lib/update-check";
import type {
  AppriseStatus,
  AppSettings,
  CachedRelease,
  CodebergTokenCheckResult,
  EnrichedRelease,
  FetchError,
  GithubRelease,
  GitlabTokenCheckResult,
  PreReleaseChannelType,
  RateLimitResult,
  Repository,
  UpdateNotificationState,
} from "@/types";
import { allPreReleaseTypes } from "@/types";

const log = logger.withScope("WebServer");
const warnRetry = (message: string) => log.warn(message);

const DEFAULT_FETCH_RETRY_ATTEMPTS = 3;
const DEFAULT_FETCH_RETRY_DELAY_MS = 500;
const DEFAULT_RESPONSE_PARSE_ATTEMPTS = 3;

function normalizeEnvToken(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const isWrappedInQuotes =
    (first === '"' && last === '"') || (first === "'" && last === "'");
  const raw = isWrappedInQuotes ? trimmed.slice(1, -1).trim() : trimmed;
  if (!raw) return null;

  // Defensive: some env providers may inject newlines/whitespace into tokens.
  // Token formats are typically alphanumeric and do not include whitespace.
  return raw.replace(/\s+/g, "");
}

function updateReleaseCacheTags(): void {
  updateTag("github-releases");
  updateTag("codeberg-releases");
  updateTag("gitlab-releases");
}

async function getRestrictedActionError(): Promise<string> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "Actions" });
  return t("error_auth_required");
}

async function isRestrictedActionAllowed(): Promise<boolean> {
  const allowed = await canPerformRestrictedAction();
  if (!allowed) {
    log.warn(
      "Rejected restricted action because the request is unauthenticated.",
    );
  }
  return allowed;
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

type FetchRetryContext = {
  description?: string;
  maxAttempts?: number;
  initialDelayMs?: number;
  parseAttempts?: number;
};

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context?: FetchRetryContext,
): Promise<Response> {
  const description = context?.description ?? url;
  const maxAttempts = context?.maxAttempts ?? DEFAULT_FETCH_RETRY_ATTEMPTS;
  const initialDelayMs =
    context?.initialDelayMs ?? DEFAULT_FETCH_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts &&
        isRetryableFetchError(error, { warn: warnRetry });
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      log.warn(
        `Retrying ${description} in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts}) due to fetch error.`,
        error,
      );
      await wait(delayMs);
    }
  }

  throw new Error(
    `Failed to fetch ${description} after ${maxAttempts} attempts.`,
  );
}

async function fetchJsonResponseWithRetry<T>(
  url: string,
  options: RequestInit,
  context?: FetchRetryContext,
): Promise<{ response: Response; data?: T }> {
  const description = context?.description ?? url;
  const parseAttempts =
    context?.parseAttempts ?? DEFAULT_RESPONSE_PARSE_ATTEMPTS;
  const initialDelayMs =
    context?.initialDelayMs ?? DEFAULT_FETCH_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= parseAttempts; attempt += 1) {
    const response = await fetchWithRetry(url, options, context);

    if (!response.ok) {
      return { response };
    }

    try {
      const data = (await response.json()) as T;
      return { response, data };
    } catch (error) {
      const shouldRetry =
        attempt < parseAttempts &&
        isRetryableFetchError(error, { warn: warnRetry });
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      log.warn(
        `Retrying ${description} JSON parse in ${delayMs}ms (attempt ${attempt + 1}/${parseAttempts}) due to response parse error.`,
        error,
      );
      await wait(delayMs);
    }
  }

  throw new Error(
    `Failed to parse JSON for ${description} after ${parseAttempts} attempts.`,
  );
}

type AuthMode = "none" | "token" | "bearer" | "basic";

async function fetchJsonResponseWithRetryAuthChain<T>(
  url: string,
  chain: Array<{ mode: AuthMode; options: RequestInit }>,
  context?: FetchRetryContext,
): Promise<{ response: Response; data?: T; mode: AuthMode }> {
  if (chain.length === 0) {
    throw new Error("fetchJsonResponseWithRetryAuthChain: empty chain");
  }

  const description = context?.description ?? url;

  for (let i = 0; i < chain.length; i += 1) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;

    const result = await fetchJsonResponseWithRetry<T>(url, candidate.options, {
      ...context,
      description:
        candidate.mode === "none"
          ? description
          : `${description} (${candidate.mode})`,
    });

    // `304 Not Modified` is a valid response for our ETag usage; don't fall back.
    if (result.response.status === 304) {
      return { ...result, mode: candidate.mode };
    }

    // For auth-related errors, try the next candidate (if any).
    if (
      !isLast &&
      (result.response.status === 401 || result.response.status === 403)
    ) {
      continue;
    }

    return { ...result, mode: candidate.mode };
  }

  // Should never happen due to early return.
  return {
    response: new Response(null, { status: 500, statusText: "Unknown Error" }),
    mode: "none",
  };
}

async function fetchResponseWithRetryAuthChain(
  url: string,
  chain: Array<{ mode: AuthMode; options: RequestInit }>,
  context?: FetchRetryContext,
): Promise<{ response: Response; mode: AuthMode }> {
  if (chain.length === 0) {
    throw new Error("fetchResponseWithRetryAuthChain: empty chain");
  }

  const description = context?.description ?? url;

  for (let i = 0; i < chain.length; i += 1) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;

    const response = await fetchWithRetry(url, candidate.options, {
      ...context,
      description:
        candidate.mode === "none"
          ? description
          : `${description} (${candidate.mode})`,
    });

    // `304 Not Modified` is a valid response for our ETag usage; don't fall back.
    if (response.status === 304) {
      return { response, mode: candidate.mode };
    }

    // For auth-related errors, try the next candidate (if any).
    if (!isLast && (response.status === 401 || response.status === 403)) {
      continue;
    }

    return { response, mode: candidate.mode };
  }

  // Should never happen due to early return.
  return {
    response: new Response(null, { status: 500, statusText: "Unknown Error" }),
    mode: "none",
  };
}

type RepoProvider = "github" | "codeberg" | "gitlab";

type ParsedRepoUrl = {
  provider: RepoProvider;
  providerHost?: string;
  owner: string;
  repo: string;
  id: string;
  canonicalRepoUrl: string;
};

function normalizeGitlabHost(value: string): string | null {
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

function getAllowedGitlabHosts(): string[] {
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

function getGitlabAccessTokensByHost(): Map<string, string> {
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

type GitlabDeployToken = {
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

function getGitlabDeployTokensByHost(): Map<string, GitlabDeployToken> {
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

type GitlabAuthConfig = {
  accessToken: string | null;
  deployToken: GitlabDeployToken | null;
};

function getGitlabAuthForHost(host: string): GitlabAuthConfig | null {
  const normalizedHost = normalizeGitlabHost(host);
  if (!normalizedHost) return null;

  const accessToken = getGitlabAccessTokensByHost().get(normalizedHost) ?? null;
  const deployToken = getGitlabDeployTokensByHost().get(normalizedHost) ?? null;

  if (!accessToken && !deployToken) return null;
  return { accessToken, deployToken };
}

function hasAnyGitlabTokenForAllowedHosts(): boolean {
  const accessTokensByHost = getGitlabAccessTokensByHost();
  const deployTokensByHost = getGitlabDeployTokensByHost();
  return getAllowedGitlabHosts().some(
    (host) => accessTokensByHost.has(host) || deployTokensByHost.has(host),
  );
}

function normalizeRepoName(repo: string): string {
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

function parseSupportedRepoUrl(url: string): ParsedRepoUrl | null {
  return parseGitHubUrl(url) ?? parseCodebergUrl(url) ?? parseGitLabUrl(url);
}

export type ComposeImportSkipReason =
  | "unsupported_registry"
  | "missing_source_label"
  | "invalid_source_url"
  | "metadata_unavailable";

export type ComposeImportSkipStats = Record<ComposeImportSkipReason, number>;

type GhcrImageReference = {
  repository: string;
  reference: string;
};

type GhcrDescriptor = {
  mediaType?: string;
  digest?: string;
  platform?: {
    architecture?: string;
    os?: string;
  };
  annotations?: Record<string, string>;
};

const GHCR_IMAGE_SOURCE_LABEL = "org.opencontainers.image.source";
const GHCR_MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const GHCR_CONFIG_ACCEPT = [
  "application/vnd.oci.image.config.v1+json",
  "application/vnd.docker.container.image.v1+json",
].join(", ");

function createComposeImportSkipStats(): ComposeImportSkipStats {
  return {
    unsupported_registry: 0,
    missing_source_label: 0,
    invalid_source_url: 0,
    metadata_unavailable: 0,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectYamlImageValues(
  value: unknown,
  images: string[] = [],
  seen = new WeakSet<object>(),
): string[] {
  if (Array.isArray(value)) {
    if (seen.has(value)) return images;
    seen.add(value);
    for (const item of value) collectYamlImageValues(item, images, seen);
    return images;
  }

  if (!isPlainRecord(value)) return images;
  if (seen.has(value)) return images;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (key === "image" && typeof child === "string") {
      images.push(child);
    }
    collectYamlImageValues(child, images, seen);
  }

  return images;
}

function parseGhcrImageReference(image: string): GhcrImageReference | null {
  const trimmed = image.trim();
  const match = trimmed.match(
    /^ghcr\.io\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)(?:(?::([\w][\w.-]{0,127}))|@([A-Za-z][A-Za-z0-9+._-]*:[A-Za-z0-9=_-]+))?$/i,
  );
  if (!match) return null;

  const owner = match[1]?.toLowerCase();
  const name = match[2]?.toLowerCase();
  if (!owner || !name) return null;

  return {
    repository: `${owner}/${name}`,
    reference: match[4] ?? match[3] ?? "latest",
  };
}

function parseBearerChallenge(
  header: string | null,
): { realm: string; service?: string; scope?: string } | null {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;

  const params: Record<string, string> = {};
  const regex = /([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g;
  for (const match of header.matchAll(regex)) {
    const key = match[1];
    const value = match[2];
    if (key && value) params[key] = value;
  }

  if (!params.realm) return null;
  return {
    realm: params.realm,
    service: params.service,
    scope: params.scope,
  };
}

async function fetchGhcrResponse(
  url: string,
  accept: string,
  description: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const firstResponse = await fetchWithRetry(
    url,
    { headers, cache: "no-store" },
    { description },
  );
  if (firstResponse.status !== 401) return firstResponse;

  const challenge = parseBearerChallenge(
    firstResponse.headers.get("www-authenticate"),
  );
  if (!challenge) return firstResponse;

  const tokenUrl = new URL(challenge.realm);
  if (challenge.service)
    tokenUrl.searchParams.set("service", challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);

  const { response, data } = await fetchJsonResponseWithRetry<{
    token?: string;
    access_token?: string;
  }>(
    tokenUrl.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "GitHubReleaseMonitorApp",
      },
      cache: "no-store",
    },
    { description: `${description} auth token` },
  );
  const token = data?.token ?? data?.access_token;
  if (!response.ok || !token) return firstResponse;

  return fetchWithRetry(
    url,
    {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
    { description: `${description} authenticated` },
  );
}

async function fetchGhcrJson<T>(
  repository: string,
  resource: "manifests" | "blobs",
  reference: string,
  accept: string,
): Promise<T | null> {
  const url = `https://ghcr.io/v2/${repository}/${resource}/${reference}`;
  const response = await fetchGhcrResponse(
    url,
    accept,
    `GHCR ${resource} ${repository}@${reference}`,
  );
  if (!response.ok) return null;

  try {
    return (await response.json()) as T;
  } catch (error) {
    log.warn(`Failed to parse GHCR ${resource} JSON for ${repository}.`, error);
    return null;
  }
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!isPlainRecord(value)) return null;
  const candidate = value[property];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function readSourceLabel(metadata: unknown): string | null {
  if (!isPlainRecord(metadata)) return null;

  const fromAnnotations = readStringProperty(
    metadata.annotations,
    GHCR_IMAGE_SOURCE_LABEL,
  );
  if (fromAnnotations) return fromAnnotations;

  const config = isPlainRecord(metadata.config) ? metadata.config : null;
  const fromConfigLabels = readStringProperty(
    config?.Labels,
    GHCR_IMAGE_SOURCE_LABEL,
  );
  if (fromConfigLabels) return fromConfigLabels;

  const containerConfig = isPlainRecord(metadata.container_config)
    ? metadata.container_config
    : null;
  return readStringProperty(containerConfig?.Labels, GHCR_IMAGE_SOURCE_LABEL);
}

function getManifestDescriptors(manifest: unknown): GhcrDescriptor[] {
  if (!isPlainRecord(manifest) || !Array.isArray(manifest.manifests)) {
    return [];
  }

  return manifest.manifests.filter(isPlainRecord).map((descriptor) => ({
    mediaType:
      typeof descriptor.mediaType === "string"
        ? descriptor.mediaType
        : undefined,
    digest:
      typeof descriptor.digest === "string" ? descriptor.digest : undefined,
    platform: isPlainRecord(descriptor.platform)
      ? {
          architecture:
            typeof descriptor.platform.architecture === "string"
              ? descriptor.platform.architecture
              : undefined,
          os:
            typeof descriptor.platform.os === "string"
              ? descriptor.platform.os
              : undefined,
        }
      : undefined,
    annotations: isPlainRecord(descriptor.annotations)
      ? Object.fromEntries(
          Object.entries(descriptor.annotations).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined,
  }));
}

function selectGhcrManifestDescriptor(
  descriptors: GhcrDescriptor[],
): GhcrDescriptor | null {
  const withDigest = descriptors.filter((descriptor) => descriptor.digest);
  if (withDigest.length === 0) return null;

  const runnable = withDigest.filter(
    (descriptor) => descriptor.platform?.os !== "unknown",
  );
  const candidates = runnable.length > 0 ? runnable : withDigest;

  return (
    candidates.find(
      (descriptor) =>
        descriptor.platform?.os === "linux" &&
        descriptor.platform.architecture === "amd64",
    ) ??
    candidates.find((descriptor) => descriptor.platform?.os === "linux") ??
    candidates[0] ??
    null
  );
}

async function getGhcrImageManifestSource(
  repository: string,
  manifest: unknown,
): Promise<string | "metadata_unavailable" | null> {
  const manifestSource = readSourceLabel(manifest);
  if (manifestSource) return manifestSource;

  if (!isPlainRecord(manifest) || !isPlainRecord(manifest.config)) {
    return null;
  }

  const configDigest = manifest.config.digest;
  if (typeof configDigest !== "string" || !configDigest) return null;

  const config = await fetchGhcrJson<unknown>(
    repository,
    "blobs",
    configDigest,
    GHCR_CONFIG_ACCEPT,
  );
  if (!config) return "metadata_unavailable";

  return readSourceLabel(config);
}

async function resolveGhcrImageSourceUrl(
  imageRef: GhcrImageReference,
): Promise<string | ComposeImportSkipReason> {
  const rootManifest = await fetchGhcrJson<unknown>(
    imageRef.repository,
    "manifests",
    imageRef.reference,
    GHCR_MANIFEST_ACCEPT,
  );
  if (!rootManifest) return "metadata_unavailable";

  const rootSource = readSourceLabel(rootManifest);
  if (rootSource) return rootSource;

  const descriptors = getManifestDescriptors(rootManifest);
  if (descriptors.length === 0) {
    const manifestSource = await getGhcrImageManifestSource(
      imageRef.repository,
      rootManifest,
    );
    return manifestSource ?? "missing_source_label";
  }

  const descriptor = selectGhcrManifestDescriptor(descriptors);
  const descriptorSource = readSourceLabel(descriptor);
  if (descriptorSource) return descriptorSource;

  if (!descriptor?.digest) return "metadata_unavailable";

  const childManifest = await fetchGhcrJson<unknown>(
    imageRef.repository,
    "manifests",
    descriptor.digest,
    GHCR_MANIFEST_ACCEPT,
  );
  if (!childManifest) return "metadata_unavailable";

  const childSource = await getGhcrImageManifestSource(
    imageRef.repository,
    childManifest,
  );
  return childSource ?? "missing_source_label";
}

export async function previewComposeImportAction(
  fileName: string,
  content: string,
): Promise<{
  success: boolean;
  repositories: Repository[];
  skipped: ComposeImportSkipStats;
  error?: string;
}> {
  const skipped = createComposeImportSkipStats();
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "RepositoryForm" });
  if (!(await isRestrictedActionAllowed())) {
    return {
      success: false,
      repositories: [],
      skipped,
      error: await getRestrictedActionError(),
    };
  }

  if (typeof content !== "string" || !content.trim()) {
    return {
      success: false,
      repositories: [],
      skipped,
      error: t("toast_import_error_parsing"),
    };
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(content);
  } catch (error) {
    log.warn(`Failed to parse Compose import file ${fileName}.`, error);
    return {
      success: false,
      repositories: [],
      skipped,
      error: t("toast_import_error_parsing"),
    };
  }

  const imageValues = Array.from(new Set(collectYamlImageValues(parsedYaml)));
  const repositories = new Map<string, Repository>();

  for (const imageValue of imageValues) {
    const imageRef = parseGhcrImageReference(imageValue);
    if (!imageRef) {
      skipped.unsupported_registry++;
      continue;
    }

    let sourceUrlOrReason: string | ComposeImportSkipReason;
    try {
      sourceUrlOrReason = await resolveGhcrImageSourceUrl(imageRef);
    } catch (error) {
      log.warn(`Failed to read GHCR metadata for ${imageValue}.`, error);
      skipped.metadata_unavailable++;
      continue;
    }

    if (
      sourceUrlOrReason === "metadata_unavailable" ||
      sourceUrlOrReason === "missing_source_label" ||
      sourceUrlOrReason === "invalid_source_url" ||
      sourceUrlOrReason === "unsupported_registry"
    ) {
      skipped[sourceUrlOrReason]++;
      continue;
    }

    const parsedSource = parseSupportedRepoUrl(sourceUrlOrReason);
    if (!parsedSource || parsedSource.provider !== "github") {
      skipped.invalid_source_url++;
      continue;
    }

    repositories.set(parsedSource.id, {
      id: parsedSource.id,
      url: parsedSource.canonicalRepoUrl,
    });
  }

  log.info(
    `Compose import preview for ${fileName}: images=${imageValues.length} repos=${repositories.size} skipped=${JSON.stringify(skipped)}`,
  );

  return {
    success: true,
    repositories: Array.from(repositories.values()),
    skipped,
  };
}

type RepoProviderResolutionCandidate = Pick<
  ParsedRepoUrl,
  "provider" | "providerHost" | "id" | "canonicalRepoUrl"
>;

function parseOwnerRepoShorthand(
  input: string,
): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) return null;
  if (trimmed.includes(" ")) return null;

  // If the user already supplied a provider prefix (e.g. github:owner/repo),
  // we consider it a different input path and don't try to auto-resolve here.
  if (trimmed.includes(":")) return null;

  const match = trimmed.match(/^([a-z0-9-._]+)\/([a-z0-9-._]+)$/i);
  if (!match) return null;

  const owner = match[1];
  const repo = normalizeRepoName(match[2]);
  return owner && repo ? { owner, repo } : null;
}

export async function resolveRepoProvidersAction(input: string): Promise<{
  success: boolean;
  candidates: RepoProviderResolutionCandidate[];
}> {
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, candidates: [] };
  }

  const parsed = parseOwnerRepoShorthand(input);
  if (!parsed) {
    log.debug(
      `Repo provider resolution skipped (not shorthand input): ${input.trim()}`,
    );
    return { success: true, candidates: [] };
  }

  const { owner, repo } = parsed;
  const candidates: RepoProviderResolutionCandidate[] = [];
  const githubTokenConfigured = Boolean(
    normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN),
  );
  const codebergTokenConfigured = Boolean(
    normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN),
  );
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  const gitlabHosts = getAllowedGitlabHosts();

  log.debug(
    `Resolving providers for shorthand repo ${owner}/${repo} (GitHub token=${githubTokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}, GitLab hosts=${gitlabHosts.join(",")}).`,
  );

  // GitHub lookup
  try {
    const githubToken = normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "GitHubReleaseMonitorApp",
    };
    if (githubToken) {
      headers.Authorization = `token ${githubToken}`;
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetchWithRetry(
      url,
      { headers, cache: "no-store" },
      { description: `GitHub repo lookup for ${owner}/${repo}` },
    );
    log.debug(
      `GitHub repo lookup for ${owner}/${repo}: ${response.status} ${response.statusText}`,
    );
    if (response.ok) {
      candidates.push({
        provider: "github",
        id: `github:${owner}/${repo}`.toLowerCase(),
        canonicalRepoUrl: `https://github.com/${owner}/${repo}`,
      });
    }
  } catch (error) {
    log.debug(`GitHub repo lookup threw for ${owner}/${repo}:`, error);
  }

  // Codeberg lookup
  try {
    const headersWithoutAuth: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "GitHubReleaseMonitorApp",
    };
    const codebergToken = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);
    const chain = buildCodebergAuthChain(headersWithoutAuth, codebergToken);
    const url = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const { response, mode } = await fetchResponseWithRetryAuthChain(
      url,
      chain,
      { description: `Codeberg repo lookup for ${owner}/${repo}` },
    );
    log.debug(
      `Codeberg repo lookup for ${owner}/${repo}: ${response.status} ${response.statusText} (auth=${mode})`,
    );
    if (response.ok) {
      candidates.push({
        provider: "codeberg",
        id: `codeberg:${owner}/${repo}`.toLowerCase(),
        canonicalRepoUrl: `https://codeberg.org/${owner}/${repo}`,
      });
    }
  } catch (error) {
    log.debug(`Codeberg repo lookup threw for ${owner}/${repo}:`, error);
  }

  // GitLab lookup (all allowed instances)
  for (const gitlabHost of gitlabHosts) {
    try {
      const headersWithoutAuth: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "GitHubReleaseMonitorApp",
      };
      const gitlabAuth = getGitlabAuthForHost(gitlabHost);
      const chain = buildGitlabAuthChain(headersWithoutAuth, gitlabAuth);
      const projectPath = `${owner}/${repo}`;
      const url = `https://${gitlabHost}/api/v4/projects/${encodeURIComponent(projectPath)}`;
      const { response, mode } = await fetchResponseWithRetryAuthChain(
        url,
        chain,
        {
          description: `GitLab repo lookup for ${owner}/${repo} on ${gitlabHost}`,
        },
      );
      log.debug(
        `GitLab repo lookup for ${owner}/${repo} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      );
      if (response.ok) {
        candidates.push({
          provider: "gitlab",
          providerHost: gitlabHost,
          id: `gitlab:${gitlabHost}/${projectPath}`.toLowerCase(),
          canonicalRepoUrl: `https://${gitlabHost}/${owner}/${repo}`,
        });
      }
    } catch (error) {
      log.debug(
        `GitLab repo lookup threw for ${owner}/${repo} on ${gitlabHost}:`,
        error,
      );
    }
  }

  log.debug(
    `Repo provider resolution for ${owner}/${repo}: candidates=${candidates.map((c) => c.provider).join(",") || "none"}`,
  );
  return { success: true, candidates };
}

// Security: Validates the repoId format.
function isValidRepoId(repoId: string): boolean {
  if (typeof repoId !== "string") return false;
  // Allows letters, numbers, hyphens, dots, and underscores in the name.
  // Enforces the "owner/repo" structure.
  // Allows an optional provider prefix like `codeberg:`.
  const repoIdRegex = /^(?:[a-z0-9-._]+:)?[a-z0-9-._]+(?:\/[a-z0-9-._]+)+$/i;
  return repoIdRegex.test(repoId);
}

function isPreReleaseByTagName(
  tagName: string,
  preReleaseSubChannels?: PreReleaseChannelType[],
): boolean {
  if (typeof tagName !== "string" || !tagName) return false;

  // If no sub-channels are provided or the array is empty, it can't match anything.
  if (!preReleaseSubChannels || preReleaseSubChannels.length === 0) {
    return false;
  }

  // This regex looks for a non-letter boundary, then one of the keywords.
  // The (?=[^a-zA-Z]|$) lookahead asserts the next character is NOT a letter
  // (or the end of the string), preventing matches like `beta` in `betamax`.
  // This matches `-b3`, `v1.0-beta`, `v1.0rc1`, and `release_candidate_1.0rc2`.
  const preReleaseRegex = new RegExp(
    `(?:^|[^a-zA-Z])(${preReleaseSubChannels.join("|")})(?=[^a-zA-Z]|$)`,
    "i",
  );
  return preReleaseRegex.test(tagName);
}

function toCachedRelease(release: GithubRelease): CachedRelease {
  return {
    html_url: release.html_url,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    created_at: release.created_at,
    published_at: release.published_at,
    published_at_unknown: release.published_at_unknown,
    fetched_at: release.fetched_at,
    source: release.id === 0 ? "tag" : "release",
  };
}

function isCachedTagFallbackRelease(release?: CachedRelease): boolean {
  if (!release) return false;
  if (release.source === "tag") return true;
  return release.name === `Tag: ${release.tag_name}`;
}

function canReplaceCachedReleaseWithVirtual(
  current: CachedRelease | undefined,
): boolean {
  return !current || isCachedTagFallbackRelease(current);
}

function applyEtagUpdate(
  repository: Repository,
  newEtag: string | null | undefined,
): boolean {
  if (newEtag === undefined) return false;

  if (newEtag === null) {
    if (repository.etag === undefined) return false;
    delete repository.etag;
    return true;
  }

  if (repository.etag === newEtag) return false;
  repository.etag = newEtag;
  return true;
}

// This constant holds the non-translatable part of the test data.
const jsCodeExample = `function greet(name) {
  // This long line tests horizontal scrolling
  console.log('Hello, ' + name + '! This line is very long to test horizontal scrolling, so it should definitely overflow the container and not wrap around.');
}

greet('World');`;

async function getComprehensiveMarkdownBody(
  locale: string,
): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: "TestRelease" });

  const body = `# ${t("title")}

${t("body_intro")}

## ${t("section_text_formatting")}

- **${t("text_bold")}**
- *${t("text_italic")}*
- ***${t("text_bold_italic")}***
- ~~${t("text_strikethrough")}~~

> ${t("text_blockquote")}

---

## ${t("section_lists")}

### ${t("list_unordered_title")}
*   ${t("list_item_1")}
*   ${t("list_item_2")}
    *   ${t("list_nested_item_1")}
    *   ${t("list_nested_item_2")}

### ${t("list_unordered_variations_title")}
+ ${t("list_plus_item_1")}
+ ${t("list_plus_item_2")}
- ${t("list_hyphen_item_1")}
- ${t("list_hyphen_item_2")}

### ${t("list_ordered_title")}
1.  ${t("list_ordered_item_1")}
2.  ${t("list_ordered_item_2")}
3.  ${t("list_ordered_item_3")}
    1.  ${t("list_nested_ordered_1")}
    2.  ${t("list_nested_ordered_2")}

---

## ${t("section_emojis")}

${t("emojis_text")} ✨ 🚀 💡

---

## ${t("section_footnotes")}

${t("footnotes_text_1")}[^1]. ${t("footnotes_text_2")}[^2].

[^1]: ${t("footnote_1_definition")}
[^2]: ${t("footnote_2_definition")}

---

## ${t("section_links")}

${t("links_text_1")} [${t("links_text_2")}](https://www.markdownguide.org).

---

## ${t("section_code_blocks")}

### ${t("code_inline_title")}
${t("code_inline_text", {
  code: `\`${t("code_inline_code_word")}\``,
})}

### ${t("code_fenced_title")}
\`\`\`javascript
// ${t("code_fenced_js_comment")}
${jsCodeExample}
\`\`\`

---

## ${t("section_table")}

| ${t("table_header_feature")} | ${t("table_header_support")} | ${t("table_header_notes")} |
|-----------------|------------------|-------------------------------------|
| ${t("table_row1_feature")} | ${t("table_row1_support")} | ${t("table_row1_notes")} |
| ${t("table_row2_feature")} | ${t("table_row2_support")} | ${t("table_row2_notes")} |
| ${t("table_row3_feature")} | ${t("table_row3_support")} | ${t("table_row3_notes")} |
| ${t("table_row4_feature")} | ${t("table_row4_support")} | ${t("table_row4_notes")} |`;

  return {
    title: t("title"),
    body: body,
  };
}

async function getBasicAppriseTestBody(
  locale: string,
): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: "TestRelease" });

  const body = `${t("apprise_basic_test_title")}

- ${t("apprise_basic_item_bold")}
- ${t("apprise_basic_item_italic")}
- ${t("apprise_basic_item_code")}

> ${t("apprise_basic_blockquote")}

${t("apprise_basic_link_text")} (https://github.com/iamspido/github-release-monitor)`;

  return {
    title: t("apprise_basic_test_notification_title"),
    body: body,
  };
}

function resolveParallelRepoFetches(settings: AppSettings): number {
  const raw = Number(settings.parallelRepoFetches);
  if (!Number.isFinite(raw)) {
    return 1;
  }
  const rounded = Math.round(raw);
  return Math.min(Math.max(rounded, 1), 50);
}

function resolveEffectiveRepoFilters(
  repoSettings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "includeRegex"
    | "excludeRegex"
    | "etag"
  >,
  globalSettings: AppSettings,
): {
  effectiveReleaseChannels: AppSettings["releaseChannels"];
  effectivePreReleaseSubChannels: PreReleaseChannelType[];
  totalReleasesToFetch: number;
  effectiveIncludeRegex: string | undefined;
  effectiveExcludeRegex: string | undefined;
} {
  const effectiveReleaseChannels =
    repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0
      ? repoSettings.releaseChannels
      : globalSettings.releaseChannels;

  const preReleaseSubChannelCandidate =
    repoSettings.preReleaseSubChannels &&
    repoSettings.preReleaseSubChannels.length > 0
      ? repoSettings.preReleaseSubChannels
      : globalSettings.preReleaseSubChannels;

  const effectivePreReleaseSubChannels =
    preReleaseSubChannelCandidate && preReleaseSubChannelCandidate.length > 0
      ? preReleaseSubChannelCandidate
      : allPreReleaseTypes;

  const totalReleasesToFetch =
    typeof repoSettings.releasesPerPage === "number" &&
    repoSettings.releasesPerPage >= 1 &&
    repoSettings.releasesPerPage <= 1000
      ? repoSettings.releasesPerPage
      : globalSettings.releasesPerPage;

  const effectiveIncludeRegex =
    repoSettings.includeRegex ?? globalSettings.includeRegex;
  const effectiveExcludeRegex =
    repoSettings.excludeRegex ?? globalSettings.excludeRegex;

  return {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  };
}

type EffectiveRepoFilters = ReturnType<typeof resolveEffectiveRepoFilters>;

function releaseMatchesEffectiveFilters(
  release: GithubRelease,
  filters: EffectiveRepoFilters,
  repoIdForLog: string,
): boolean {
  try {
    if (filters.effectiveExcludeRegex) {
      const exclude = new RegExp(filters.effectiveExcludeRegex, "i");
      if (exclude.test(release.tag_name)) return false;
    }
    if (filters.effectiveIncludeRegex) {
      const include = new RegExp(filters.effectiveIncludeRegex, "i");
      return include.test(release.tag_name);
    }
  } catch (error) {
    log.error(
      `Invalid regex for repo ${repoIdForLog}. Regex filters will be ignored. Error:`,
      error,
    );
  }

  if (release.draft) {
    return filters.effectiveReleaseChannels.includes("draft");
  }

  const isTagMarkedPreRelease = isPreReleaseByTagName(
    release.tag_name,
    allPreReleaseTypes,
  );
  const isConsideredPreRelease = release.prerelease || isTagMarkedPreRelease;

  if (isConsideredPreRelease) {
    if (!filters.effectiveReleaseChannels.includes("prerelease")) return false;

    // If the tag explicitly includes a pre-release marker (e.g. -beta/-rc),
    // apply the configured sub-channel filter. Otherwise, fall back to the API flag.
    if (isTagMarkedPreRelease) {
      return isPreReleaseByTagName(
        release.tag_name,
        filters.effectivePreReleaseSubChannels,
      );
    }

    return true;
  }

  return filters.effectiveReleaseChannels.includes("stable");
}

async function fetchLatestReleaseFromGitHub(
  owner: string,
  repo: string,
  repoSettings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "includeRegex"
    | "excludeRegex"
    | "etag"
    | "latestRelease"
  >,
  globalSettings: AppSettings,
  locale: string,
): Promise<{
  release: GithubRelease | null;
  error: FetchError | null;
  newEtag?: string | null;
}> {
  log.info(`Fetching GitHub release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

  // --- Special handling for the virtual test repository ---
  if (owner === "test" && repo === "test") {
    const { title, body } = await getComprehensiveMarkdownBody(locale);
    const release = {
      id: 1,
      html_url: "https://github.com/test/test/releases/tag/v1.0.0-simulated",
      tag_name: "v1.0.0-simulated",
      name: title,
      body: body,
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      prerelease: false,
      draft: false,
      fetched_at: fetchedAtTimestamp,
    };
    return { release, error: null };
  }

  // --- GitHub API Fetching with Pagination ---
  const GITHUB_API_BASE_URL = `https://api.github.com/repos/${owner}/${repo}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | null | undefined;

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
    for (let page = 1; page <= pagesToFetch; page++) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${GITHUB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeaders = { ...headers };
      // Only use ETag for the first page request.
      if (
        page === 1 &&
        repoSettings.etag &&
        repoSettings.latestRelease &&
        !isCachedTagFallbackRelease(repoSettings.latestRelease)
      ) {
        currentHeaders["If-None-Match"] = repoSettings.etag;
      }
      const fetchOptions: RequestInit = {
        headers: currentHeaders,
        cache: "no-store",
      };

      const { response, data: pageReleases } = await fetchJsonResponseWithRetry<
        GithubRelease[]
      >(url, fetchOptions, {
        description: `GitHub releases for ${owner}/${repo} page ${page}`,
      });

      // For the first page, check for 304 Not Modified.
      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          log.info(`[ETag] No changes for ${owner}/${repo}.`);
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          log.error(
            `GitHub API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`,
          );
          return { release: null, error: { type: "repo_not_found" }, newEtag };
        }
        if (response.status === 403) {
          const rateLimitLimit = response.headers.get("x-ratelimit-limit");
          const rateLimitRemaining = response.headers.get(
            "x-ratelimit-remaining",
          );
          const rateLimitReset = response.headers.get("x-ratelimit-reset");
          const resetTime = rateLimitReset
            ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString()
            : "N/A";

          log.error(
            `GitHub API rate limit exceeded for ${owner}/${repo}. ` +
              `Limit: ${rateLimitLimit}, Remaining: ${rateLimitRemaining}, Resets at: ${resetTime}. ` +
              "Please add or check your GITHUB_ACCESS_TOKEN.",
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }
        log.error(
          `GitHub API error for ${owner}/${repo}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `GitHub API returned an empty body for ${owner}/${repo} releases page ${page}.`,
        );
      }

      allReleases = [...allReleases, ...pageReleases];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      log.info(
        `No formal releases found for ${owner}/${repo}. Falling back to tags.`,
      );
      newEtag = null;

      const allTags: { name: string; commit: { sha: string } }[] = [];
      for (let page = 1; page <= pagesToFetch; page++) {
        const tagsOnThisPage = Math.min(
          MAX_PER_PAGE,
          totalReleasesToFetch - allTags.length,
        );
        if (tagsOnThisPage <= 0) break;

        const { response: tagsResponse, data: pageTags } =
          await fetchJsonResponseWithRetry<
            { name: string; commit: { sha: string } }[]
          >(
            `${GITHUB_API_BASE_URL}/tags?per_page=${tagsOnThisPage}&page=${page}`,
            { headers, cache: "no-store" },
            { description: `GitHub tags for ${owner}/${repo} page ${page}` },
          );

        if (!tagsResponse.ok) {
          log.error(
            `Failed to fetch tags for ${owner}/${repo} after failing to find releases.`,
          );
          return {
            release: null,
            error: { type: "no_releases_found" },
            newEtag,
          };
        }

        if (!pageTags) {
          throw new Error(
            `GitHub API returned an empty body for ${owner}/${repo} tags page ${page}.`,
          );
        }

        allTags.push(...pageTags);

        if (pageTags.length < tagsOnThisPage) {
          break;
        }
      }

      if (allTags.length === 0) {
        log.info(`No tags found for ${owner}/${repo}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const tagCandidates = allTags.map((tag) => ({
        tag,
        release: {
          id: 0,
          html_url: `https://github.com/${owner}/${repo}/releases/tag/${tag.name}`,
          tag_name: tag.name,
          name: `Tag: ${tag.name}`,
          body: "",
          created_at: fetchedAtTimestamp,
          published_at: fetchedAtTimestamp,
          prerelease: false,
          draft: false,
        } satisfies GithubRelease,
      }));

      const selectedCandidate = tagCandidates.find(({ release }) =>
        releaseMatchesEffectiveFilters(
          release,
          {
            effectiveReleaseChannels,
            effectivePreReleaseSubChannels,
            totalReleasesToFetch,
            effectiveIncludeRegex,
            effectiveExcludeRegex,
          },
          `${owner}/${repo}`,
        ),
      );

      if (!selectedCandidate) {
        log.info(
          `No tags found for ${owner}/${repo} matching the configured filters.`,
        );
        return {
          release: null,
          error: { type: "no_matching_releases" },
          newEtag,
        };
      }

      const latestTag = selectedCandidate.tag;
      const t = await getTranslations({ locale, namespace: "Actions" });

      let bodyContent = "";
      let publicationDate = new Date().toISOString();

      try {
        const { response: refResponse, data: refData } =
          await fetchJsonResponseWithRetry<{
            object: { type: string; sha: string; url: string };
          }>(
            `${GITHUB_API_BASE_URL}/git/ref/tags/${latestTag.name}`,
            { headers, cache: "no-store" },
            {
              description: `Git reference for ${owner}/${repo} tag ${latestTag.name}`,
            },
          );

        if (refResponse.ok && refData) {
          // If it's an annotated tag, the object type is 'tag'.
          if (refData.object.type === "tag") {
            const { response: annotatedTagResponse, data: annotatedTagData } =
              await fetchJsonResponseWithRetry<{
                message?: string;
                tagger?: { date?: string };
              }>(
                refData.object.url,
                { headers, cache: "no-store" },
                {
                  description: `Annotated tag for ${owner}/${repo} tag ${latestTag.name}`,
                },
              );
            if (annotatedTagResponse.ok && annotatedTagData) {
              if (annotatedTagData.message) {
                bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${annotatedTagData.message}`;
              }
              publicationDate =
                annotatedTagData.tagger?.date || publicationDate;
            }
          }
        }

        // If no annotated tag message was found (either lightweight tag or error), fall back to commit message.
        if (!bodyContent) {
          const { response: commitResponse, data: commitData } =
            await fetchJsonResponseWithRetry<{
              commit: { message: string; committer: { date: string } };
            }>(
              `${GITHUB_API_BASE_URL}/commits/${latestTag.commit.sha}`,
              { headers, cache: "no-store" },
              {
                description: `GitHub commit ${latestTag.commit.sha} for ${owner}/${repo}`,
              },
            );
          if (commitResponse.ok && commitData) {
            bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commitData.commit.message}`;
            publicationDate = commitData.commit.committer.date;
          } else {
            log.error(
              `Failed to fetch commit for tag ${latestTag.name} in ${owner}/${repo}.`,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }
        }
      } catch (e) {
        log.error(`Error during tag fallback for ${owner}/${repo}:`, e);
        return { release: null, error: { type: "api_error" } };
      }

      const virtualRelease: GithubRelease = {
        ...selectedCandidate.release,
        body: bodyContent,
        created_at: publicationDate,
        published_at: publicationDate,
      };
      allReleases = [virtualRelease];
    }

    // Filter releases according to configured channels/regex
    const filteredReleases = allReleases.filter((release) =>
      releaseMatchesEffectiveFilters(
        release,
        {
          effectiveReleaseChannels,
          effectivePreReleaseSubChannels,
          totalReleasesToFetch,
          effectiveIncludeRegex,
          effectiveExcludeRegex,
        },
        `${owner}/${repo}`,
      ),
    );

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    // Sort by published_at (fallback to created_at) desc to ensure stability
    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

    // This check is for formal releases that have an empty body.
    // The tag fallback already populates the body with a commit message.
    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      log.info(
        `Release body for ${owner}/${repo} tag ${latestRelease.tag_name} is empty. Attempting to fetch commit message.`,
      );
      const commitApiUrl = `${GITHUB_API_BASE_URL}/commits/${latestRelease.tag_name}`;
      try {
        const { response: commitResponse, data: commitData } =
          await fetchJsonResponseWithRetry<{
            commit?: { message?: string };
          }>(
            commitApiUrl,
            { headers, cache: "no-store" },
            {
              description: `GitHub commit for ${owner}/${repo} tag ${latestRelease.tag_name}`,
            },
          );
        if (commitResponse.ok && commitData?.commit?.message) {
          const t = await getTranslations({ locale, namespace: "Actions" });
          latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commitData.commit.message}`;
          log.info(
            `Successfully fetched commit message for ${owner}/${repo} tag ${latestRelease.tag_name}.`,
          );
        } else if (commitResponse.ok) {
          log.info(
            `Commit message for ${owner}/${repo} tag ${latestRelease.tag_name} could not be retrieved from commit data.`,
          );
        } else {
          log.error(
            `Failed to fetch commit for ${owner}/${repo} tag ${latestRelease.tag_name}: ${commitResponse.status} ${commitResponse.statusText}`,
          );
        }
      } catch (error) {
        log.error(
          `Error fetching commit for tag ${latestRelease.tag_name} in ${owner}/${repo}:`,
          error,
        );
      }
    }

    if (latestRelease) {
      latestRelease.fetched_at = new Date().toISOString();
    }

    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

type RepoSettingsForFetch = Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "releasesPerPage"
  | "cacheInterval"
  | "includeRegex"
  | "excludeRegex"
  | "etag"
  | "latestRelease"
>;

type LatestReleaseFetchResult = {
  release: GithubRelease | null;
  error: FetchError | null;
  newEtag?: string | null;
};

type GitlabReleaseApi = {
  name?: string | null;
  tag_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  released_at?: string | null;
  upcoming_release?: boolean | null;
};

type GitlabTagApi = {
  name: string;
  message?: string | null;
  release?: {
    description?: string | null;
  } | null;
  commit?: {
    id?: string | null;
    message?: string | null;
    created_at?: string | null;
    committed_date?: string | null;
    authored_date?: string | null;
  } | null;
};

type GitlabCommitApi = {
  message?: string | null;
  committed_date?: string | null;
  authored_date?: string | null;
  created_at?: string | null;
};

type ParsedTagSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

type GitSmartTagRef = {
  name: string;
  objectId: string;
  peeledObjectId?: string;
};

type GitTransportTag = {
  name: string;
  commitSha: string | null;
};

function hashStringToId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function extractGitlabCommitDate(
  commit:
    | {
        committed_date?: string | null;
        authored_date?: string | null;
        created_at?: string | null;
      }
    | null
    | undefined,
): string | undefined {
  if (!commit) return undefined;
  if (typeof commit.committed_date === "string") return commit.committed_date;
  if (typeof commit.authored_date === "string") return commit.authored_date;
  if (typeof commit.created_at === "string") return commit.created_at;
  return undefined;
}

function buildGitlabAuthChain(
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
): Array<{ mode: AuthMode; options: RequestInit }> {
  const chain: Array<{ mode: AuthMode; options: RequestInit }> = [];
  const accessToken = auth?.accessToken ?? null;
  const deployToken = auth?.deployToken ?? null;

  if (accessToken) {
    chain.push({
      mode: "token",
      options: {
        headers: {
          ...headersWithoutAuth,
          "PRIVATE-TOKEN": accessToken,
        },
        cache: "no-store",
      },
    });
    chain.push({
      mode: "bearer",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    });
  }

  if (deployToken) {
    const basicAuth = Buffer.from(
      `${deployToken.username}:${deployToken.token}`,
    ).toString("base64");
    chain.push({
      mode: "basic",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Basic ${basicAuth}`,
        },
        cache: "no-store",
      },
    });
  }

  chain.push({
    mode: "none",
    options: { headers: headersWithoutAuth, cache: "no-store" },
  });

  return chain;
}

function parseTagSemver(tagName: string): ParsedTagSemver | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      tagName.trim(),
    );
  if (!match) return null;

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

function compareTagNamesByRecency(a: string, b: string): number {
  const aSemver = parseTagSemver(a);
  const bSemver = parseTagSemver(b);

  if (aSemver && bSemver) {
    if (aSemver.major !== bSemver.major) return aSemver.major - bSemver.major;
    if (aSemver.minor !== bSemver.minor) return aSemver.minor - bSemver.minor;
    if (aSemver.patch !== bSemver.patch) return aSemver.patch - bSemver.patch;

    // Stable release sorts after prerelease for the same version.
    if (!aSemver.prerelease && bSemver.prerelease) return 1;
    if (aSemver.prerelease && !bSemver.prerelease) return -1;
    if (aSemver.prerelease && bSemver.prerelease) {
      return aSemver.prerelease.localeCompare(bSemver.prerelease, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    return 0;
  }

  if (aSemver && !bSemver) return 1;
  if (!aSemver && bSemver) return -1;

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function parseGitSmartHttpTagRefs(payload: Uint8Array): GitSmartTagRef[] {
  const refsByName = new Map<string, GitSmartTagRef>();
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 4 <= payload.length) {
    const lengthHex = decoder.decode(payload.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
      break;
    }

    const packetLength = Number.parseInt(lengthHex, 16);
    offset += 4;

    if (packetLength === 0) {
      continue;
    }

    const dataLength = packetLength - 4;
    if (dataLength <= 0 || offset + dataLength > payload.length) {
      break;
    }

    const packetData = decoder.decode(
      payload.subarray(offset, offset + dataLength),
    );
    offset += dataLength;

    const withoutTrailingNewline = packetData.endsWith("\n")
      ? packetData.slice(0, -1)
      : packetData;
    if (withoutTrailingNewline.startsWith("# service=")) {
      continue;
    }

    const spaceIndex = withoutTrailingNewline.indexOf(" ");
    if (spaceIndex <= 0) {
      continue;
    }

    const objectId = withoutTrailingNewline.slice(0, spaceIndex).trim();
    if (!/^[0-9a-fA-F]{40,64}$/.test(objectId)) {
      continue;
    }

    let refName = withoutTrailingNewline.slice(spaceIndex + 1).trim();
    const nulIndex = refName.indexOf("\u0000");
    if (nulIndex !== -1) {
      refName = refName.slice(0, nulIndex);
    }
    if (!refName.startsWith("refs/tags/")) {
      continue;
    }

    const rawTagName = refName.slice("refs/tags/".length);
    const isPeeled = rawTagName.endsWith("^{}");
    const tagName = isPeeled ? rawTagName.slice(0, -3) : rawTagName;
    if (!tagName) {
      continue;
    }

    const existing = refsByName.get(tagName) ?? { name: tagName, objectId };
    if (isPeeled) {
      existing.peeledObjectId = objectId;
    } else {
      existing.objectId = objectId;
    }
    refsByName.set(tagName, existing);
  }

  return [...refsByName.values()];
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodeGitPktLine(data: string): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(data);
  const header = encoder.encode(
    (payload.length + 4).toString(16).padStart(4, "0"),
  );
  return concatUint8Arrays([header, payload]);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function extractPackPayloadFromUploadPackResponse(
  payload: Uint8Array,
): Uint8Array | null {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const packSignature = encoder.encode("PACK");
  const packChunks: Uint8Array[] = [];
  let offset = 0;

  while (offset + 4 <= payload.length) {
    const lengthHex = decoder.decode(payload.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
      break;
    }

    const packetLength = Number.parseInt(lengthHex, 16);
    offset += 4;

    if (packetLength === 0) {
      continue;
    }

    const dataLength = packetLength - 4;
    if (dataLength <= 0 || offset + dataLength > payload.length) {
      break;
    }

    const packetData = payload.subarray(offset, offset + dataLength);
    offset += dataLength;

    if (packetData.length === 0) continue;

    const channel = packetData[0];
    if (channel === 1 && packetData.length > 1) {
      packChunks.push(packetData.subarray(1));
      continue;
    }

    if (channel === 2 || channel === 3) {
      continue;
    }

    const packIndex = indexOfBytes(packetData, packSignature);
    if (packIndex !== -1) {
      packChunks.push(packetData.subarray(packIndex));
    }
  }

  if (packChunks.length > 0) {
    return concatUint8Arrays(packChunks);
  }

  const directPackIndex = indexOfBytes(payload, packSignature);
  if (directPackIndex !== -1) {
    return payload.subarray(directPackIndex);
  }

  return null;
}

function parseGitTimestampToIso(headerLine: string): string | undefined {
  const timestampMatch = / (\d+) [+-]\d{4}$/.exec(headerLine);
  if (!timestampMatch) return undefined;

  const seconds = Number.parseInt(timestampMatch[1], 10);
  if (!Number.isFinite(seconds)) return undefined;

  return new Date(seconds * 1000).toISOString();
}

function parseGitObjectMetadata(
  objectType: number,
  objectText: string,
): { message?: string; date?: string } | null {
  if (objectType !== 1 && objectType !== 4) return null;

  const splitIndex = objectText.indexOf("\n\n");
  const headerPart =
    splitIndex === -1 ? objectText : objectText.slice(0, splitIndex);
  const messagePart =
    splitIndex === -1 ? "" : objectText.slice(splitIndex + 2).trim();

  let date: string | undefined;
  const headerPrefix = objectType === 1 ? "committer " : "tagger ";
  for (const line of headerPart.split("\n")) {
    if (line.startsWith(headerPrefix)) {
      date = parseGitTimestampToIso(line);
      break;
    }
  }

  const message = messagePart || undefined;
  if (!message && !date) return null;

  return { message, date };
}

function parseFirstGitObjectMetadataFromPack(
  packPayload: Uint8Array,
): { message?: string; date?: string } | null {
  const decoder = new TextDecoder();
  if (packPayload.length < 32) return null;
  if (decoder.decode(packPayload.subarray(0, 4)) !== "PACK") return null;

  const objectCount = new DataView(
    packPayload.buffer,
    packPayload.byteOffset + 8,
    4,
  ).getUint32(0, false);
  if (objectCount < 1) return null;

  let offset = 12;
  if (offset >= packPayload.length) return null;

  let headerByte = packPayload[offset];
  offset += 1;
  const objectType = (headerByte >> 4) & 0x07;
  while ((headerByte & 0x80) !== 0) {
    if (offset >= packPayload.length) return null;
    headerByte = packPayload[offset];
    offset += 1;
  }

  const compressedEnd = Math.max(offset, packPayload.length - 20);
  if (offset >= compressedEnd) return null;

  try {
    const inflated = inflateSync(packPayload.subarray(offset, compressedEnd));
    const objectText = decoder.decode(inflated);
    return parseGitObjectMetadata(objectType, objectText);
  } catch (error) {
    log.debug("Failed to parse git pack object for commit metadata:", error);
    return null;
  }
}

async function tryFetchGitlabCommitMetadataViaGitTransport(
  gitlabHost: string,
  projectPath: string,
  deployToken: GitlabDeployToken,
  commitSha: string,
): Promise<{ message?: string; date?: string } | null> {
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) return null;

  const encodedPath = projectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const uploadPackUrl = `https://${gitlabHost}/${encodedPath}.git/git-upload-pack`;

  const basicAuth = Buffer.from(
    `${deployToken.username}:${deployToken.token}`,
  ).toString("base64");
  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/x-git-upload-pack-result",
    "Content-Type": "application/x-git-upload-pack-request",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const payloads: Uint8Array[] = [
    concatUint8Arrays([
      encodeGitPktLine(`want ${commitSha} side-band-64k filter\n`),
      encodeGitPktLine("deepen 1\n"),
      encodeGitPktLine("filter tree:0\n"),
      new TextEncoder().encode("0000"),
      encodeGitPktLine("done\n"),
    ]),
    concatUint8Arrays([
      encodeGitPktLine(`want ${commitSha} side-band-64k\n`),
      new TextEncoder().encode("0000"),
      encodeGitPktLine("done\n"),
    ]),
  ];

  for (const payload of payloads) {
    const requestBody = Buffer.from(payload);
    const authChain = [
      {
        mode: "basic" as const,
        options: {
          method: "POST",
          body: requestBody,
          headers: {
            ...headersWithoutAuth,
            Authorization: `Basic ${basicAuth}`,
          },
          cache: "no-store" as const,
        },
      },
      {
        mode: "none" as const,
        options: {
          method: "POST",
          body: requestBody,
          headers: headersWithoutAuth,
          cache: "no-store" as const,
        },
      },
    ];

    const { response, mode } = await fetchResponseWithRetryAuthChain(
      uploadPackUrl,
      authChain,
      {
        description: `Git transport commit metadata for ${projectPath} (${commitSha.slice(0, 12)}) on ${gitlabHost}`,
      },
    );

    if (!response.ok) {
      log.debug(
        `Git transport commit metadata lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      );
      continue;
    }

    const uploadPackResponse = new Uint8Array(await response.arrayBuffer());
    const packPayload =
      extractPackPayloadFromUploadPackResponse(uploadPackResponse);
    if (!packPayload) {
      continue;
    }

    const metadata = parseFirstGitObjectMetadataFromPack(packPayload);
    if (metadata) {
      return metadata;
    }
  }

  return null;
}

async function fetchGitlabTagsViaGitTransport(
  gitlabHost: string,
  projectPath: string,
  deployToken: GitlabDeployToken,
): Promise<GitTransportTag[] | null> {
  const encodedPath = projectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const gitRefsUrl = `https://${gitlabHost}/${encodedPath}.git/info/refs?service=git-upload-pack`;

  const basicAuth = Buffer.from(
    `${deployToken.username}:${deployToken.token}`,
  ).toString("base64");
  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/x-git-upload-pack-advertisement",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const { response, mode } = await fetchResponseWithRetryAuthChain(
    gitRefsUrl,
    [
      {
        mode: "basic",
        options: {
          headers: {
            ...headersWithoutAuth,
            Authorization: `Basic ${basicAuth}`,
          },
          cache: "no-store",
        },
      },
      {
        mode: "none",
        options: { headers: headersWithoutAuth, cache: "no-store" },
      },
    ],
    {
      description: `Git transport tags for ${projectPath} on ${gitlabHost}`,
    },
  );

  if (!response.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = undefined;
    }
    log.warn(
      `Git transport tags lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      bodyText ? { bodyText } : undefined,
    );
    return null;
  }

  const payload = new Uint8Array(await response.arrayBuffer());
  const refs = parseGitSmartHttpTagRefs(payload);
  if (refs.length === 0) {
    return [];
  }

  const sortedTags = refs
    .map((ref) => ({
      name: ref.name,
      commitSha: ref.peeledObjectId ?? ref.objectId ?? null,
    }))
    .sort((a, b) => compareTagNamesByRecency(b.name, a.name));
  return sortedTags;
}

async function tryFetchGitlabCommitMessage(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const chain = buildGitlabAuthChain(headersWithoutAuth, auth);
  const url = `${apiBaseUrl}/repository/commits/${encodeURIComponent(refOrSha)}`;
  try {
    const { response, data } =
      await fetchJsonResponseWithRetryAuthChain<GitlabCommitApi>(url, chain, {
        description: `GitLab commit (${refOrSha})`,
      });
    if (!response.ok || !data) return null;

    const message = typeof data.message === "string" ? data.message : undefined;
    const date = extractGitlabCommitDate(data);

    if (!message && !date) return null;
    return { message, date };
  } catch {
    return null;
  }
}

async function fetchLatestReleaseFromGitLab(
  gitlabHost: string,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  const projectPath = `${owner}/${repo}`;
  log.info(`Fetching GitLab release for ${projectPath} on ${gitlabHost}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

  const GITLAB_API_BASE_URL = `https://${gitlabHost}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;
  let fellBackToTagsAfterReleases404 = false;
  const gitTransportCommitShasByTag = new Map<string, string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const gitlabAuth = getGitlabAuthForHost(gitlabHost);

  try {
    for (let page = 1; page <= pagesToFetch; page += 1) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${GITLAB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      if (page === 1 && repoSettings.etag) {
        currentHeadersWithoutAuth["If-None-Match"] = repoSettings.etag;
      }

      const chain = buildGitlabAuthChain(currentHeadersWithoutAuth, gitlabAuth);

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<GitlabReleaseApi[]>(
          url,
          chain,
          {
            description: `GitLab releases for ${projectPath} page ${page}`,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          log.info(
            `[ETag] No changes for gitlab:${gitlabHost}/${projectPath}.`,
          );
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          if (gitlabAuth?.deployToken && !gitlabAuth.accessToken) {
            log.warn(
              `GitLab releases endpoint returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Falling back to tags endpoint.`,
            );
            fellBackToTagsAfterReleases404 = true;
            break;
          }
          log.error(
            `GitLab API error for ${projectPath}: Not Found (404). The repository may not exist or is private.`,
          );
          return { release: null, error: { type: "repo_not_found" }, newEtag };
        }
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get("retry-after"))
        ) {
          const retryAfter = response.headers.get("retry-after") ?? "N/A";
          const remaining =
            response.headers.get("ratelimit-remaining") ?? "N/A";
          const reset = response.headers.get("ratelimit-reset") ?? "N/A";
          log.error(
            `GitLab API rate limit exceeded for ${projectPath}. Remaining: ${remaining}, Reset: ${reset}, Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `GitLab API error for ${projectPath}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `GitLab API returned an empty body for ${projectPath} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases
          .map((release) => {
            const tagName =
              typeof release.tag_name === "string" ? release.tag_name : null;
            if (!tagName) return null;

            const createdAt =
              typeof release.created_at === "string"
                ? release.created_at
                : typeof release.released_at === "string"
                  ? release.released_at
                  : fetchedAtTimestamp;

            const publishedAt =
              typeof release.released_at === "string"
                ? release.released_at
                : typeof release.created_at === "string"
                  ? release.created_at
                  : null;

            const mapped: GithubRelease = {
              id: hashStringToId(tagName),
              html_url: `https://${gitlabHost}/${projectPath}/-/releases/${encodeURIComponent(tagName)}`,
              tag_name: tagName,
              name: typeof release.name === "string" ? release.name : null,
              body:
                typeof release.description === "string"
                  ? release.description
                  : null,
              created_at: createdAt,
              published_at: publishedAt,
              prerelease: false,
              draft: !!release.upcoming_release,
            };
            return mapped;
          })
          .filter((release): release is GithubRelease => release !== null),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      if (fellBackToTagsAfterReleases404) {
        log.info(
          `Falling back to tags for ${projectPath} after releases endpoint 404.`,
        );
      } else {
        log.info(
          `No formal releases found for ${projectPath}. Falling back to tags.`,
        );
      }
      const tagUrls = [
        `${GITLAB_API_BASE_URL}/repository/tags?per_page=1&order_by=updated&sort=desc`,
        `${GITLAB_API_BASE_URL}/repository/tags?per_page=1`,
        `${GITLAB_API_BASE_URL}/repository/tags`,
      ];

      let tagsResponse: Response | null = null;
      let tags: GitlabTagApi[] | undefined;
      let hadSuccessfulTagResponse = false;

      for (const tagUrl of tagUrls) {
        const tagChain = buildGitlabAuthChain(headersWithoutAuth, gitlabAuth);
        const result = await fetchJsonResponseWithRetryAuthChain<
          GitlabTagApi[]
        >(tagUrl, tagChain, { description: `GitLab tags for ${projectPath}` });
        tagsResponse = result.response;

        if (!tagsResponse.ok) {
          // Some GitLab versions don't support order_by/sort on tags. Retry with a simpler endpoint.
          if (tagsResponse.status === 400) {
            continue;
          }
          break;
        }

        hadSuccessfulTagResponse = true;
        const receivedTags = result.data ?? [];
        if (receivedTags.length > 0) {
          tags = receivedTags;
          break;
        }
      }

      if (!hadSuccessfulTagResponse) {
        let bodyText: string | undefined;
        try {
          bodyText = tagsResponse ? await tagsResponse.text() : undefined;
        } catch {
          bodyText = undefined;
        }

        const details =
          tagsResponse == null
            ? "no response"
            : `${tagsResponse.status} ${tagsResponse.statusText}`;

        const canTryGitTransportFallback =
          tagsResponse?.status === 404 &&
          Boolean(gitlabAuth?.deployToken && !gitlabAuth.accessToken);

        if (canTryGitTransportFallback) {
          log.warn(
            `Tag API returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Trying Git transport fallback.`,
            bodyText ? { bodyText } : undefined,
          );

          try {
            const deployToken = gitlabAuth?.deployToken;
            if (!deployToken) {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
            const gitTransportTags = await fetchGitlabTagsViaGitTransport(
              gitlabHost,
              projectPath,
              deployToken,
            );

            if (gitTransportTags && gitTransportTags.length > 0) {
              const t = await getTranslations({ locale, namespace: "Actions" });
              const commitTitle = t("commit_message_fallback_title");
              const unavailableText = t("commit_message_unavailable_fallback");
              const fallbackTimestamp = new Date().toISOString();
              allReleases = gitTransportTags.map((tag) => {
                if (tag.commitSha) {
                  gitTransportCommitShasByTag.set(tag.name, tag.commitSha);
                }
                const shortSha = tag.commitSha?.slice(0, 12);
                const body = shortSha
                  ? `### ${commitTitle}\n\n---\n\n${unavailableText}\n\nCommit: \`${shortSha}\``
                  : `### ${commitTitle}\n\n---\n\n${unavailableText}`;

                return {
                  id: hashStringToId(tag.name),
                  html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(tag.name)}`,
                  tag_name: tag.name,
                  name: `Tag: ${tag.name}`,
                  body,
                  created_at: fallbackTimestamp,
                  published_at: fallbackTimestamp,
                  published_at_unknown: true,
                  prerelease: false,
                  draft: false,
                };
              });
              log.info(
                `Git transport fallback found ${gitTransportTags.length} tags for ${projectPath}.`,
              );
            } else if (gitTransportTags && gitTransportTags.length === 0) {
              log.info(
                `Git transport fallback found no tags for ${projectPath}.`,
              );
              return {
                release: null,
                error: { type: "no_releases_found" },
                newEtag,
              };
            } else {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
          } catch (error) {
            log.error(
              `Git transport fallback failed for ${projectPath} on ${gitlabHost}.`,
              error,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }
        } else {
          log.error(
            `Failed to fetch tags for ${projectPath} after failing to find releases. (${details})`,
            bodyText ? { bodyText } : undefined,
          );
          if (tagsResponse?.status === 404) {
            return {
              release: null,
              error: { type: "repo_not_found" },
              newEtag,
            };
          }
          return { release: null, error: { type: "api_error" }, newEtag };
        }
      }

      if (allReleases.length === 0) {
        if (!tags || tags.length === 0) {
          log.info(`No tags found for ${projectPath}.`);
          return {
            release: null,
            error: { type: "no_releases_found" },
            newEtag,
          };
        }

        const latestTag = tags[0];
        const t = await getTranslations({ locale, namespace: "Actions" });
        let bodyContent = "";
        let publicationDate =
          extractGitlabCommitDate(latestTag.commit) || new Date().toISOString();

        const tagMessage =
          typeof latestTag.message === "string" ? latestTag.message : null;
        const releaseDescription =
          typeof latestTag.release?.description === "string"
            ? latestTag.release.description
            : null;

        if (tagMessage) {
          bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${tagMessage}`;
        } else if (releaseDescription) {
          bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${releaseDescription}`;
        }

        if (!bodyContent && typeof latestTag.commit?.message === "string") {
          bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${latestTag.commit.message}`;
        }

        if (!bodyContent) {
          const ref = latestTag.commit?.id ?? latestTag.name;
          const commit = await tryFetchGitlabCommitMessage(
            GITLAB_API_BASE_URL,
            headersWithoutAuth,
            gitlabAuth,
            ref,
          );
          if (commit?.message) {
            bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
          }
          if (commit?.date) {
            publicationDate = commit.date;
          }
        }

        const virtualRelease: GithubRelease = {
          id: 0,
          html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(latestTag.name)}`,
          tag_name: latestTag.name,
          name: `Tag: ${latestTag.name}`,
          body: bodyContent,
          created_at: publicationDate,
          published_at: publicationDate,
          prerelease: false,
          draft: false,
        };
        allReleases = [virtualRelease];
      }
    }

    const filteredReleases = allReleases.filter((r) => {
      try {
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, "i");
          if (exclude.test(r.tag_name)) return false;
        }
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, "i");
          return include.test(r.tag_name);
        }
      } catch (e) {
        log.error(
          `Invalid regex for repo gitlab:${gitlabHost}/${projectPath}. Regex filters will be ignored. Error:`,
          e,
        );
      }

      if (r.draft) {
        return effectiveReleaseChannels.includes("draft");
      }

      const isTagMarkedPreRelease = isPreReleaseByTagName(
        r.tag_name,
        allPreReleaseTypes,
      );
      const isConsideredPreRelease = r.prerelease || isTagMarkedPreRelease;

      if (isConsideredPreRelease) {
        if (!effectiveReleaseChannels.includes("prerelease")) return false;

        if (isTagMarkedPreRelease) {
          return isPreReleaseByTagName(
            r.tag_name,
            effectivePreReleaseSubChannels,
          );
        }

        return true;
      }

      return effectiveReleaseChannels.includes("stable");
    });

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

    if (
      latestRelease.published_at_unknown &&
      gitlabAuth?.deployToken &&
      !gitlabAuth.accessToken
    ) {
      const commitSha = gitTransportCommitShasByTag.get(latestRelease.tag_name);
      if (commitSha) {
        const metadata = await tryFetchGitlabCommitMetadataViaGitTransport(
          gitlabHost,
          projectPath,
          gitlabAuth.deployToken,
          commitSha,
        );
        if (metadata?.message) {
          const t = await getTranslations({ locale, namespace: "Actions" });
          latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${metadata.message}`;
        }
        if (metadata?.date) {
          latestRelease.created_at = metadata.date;
          latestRelease.published_at = metadata.date;
          latestRelease.published_at_unknown = false;
        }
      }
    }

    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      const commit = await tryFetchGitlabCommitMessage(
        GITLAB_API_BASE_URL,
        headersWithoutAuth,
        gitlabAuth,
        latestRelease.tag_name,
      );
      if (commit?.message) {
        const t = await getTranslations({ locale, namespace: "Actions" });
        latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
      }
      if (commit?.date) {
        latestRelease.published_at = latestRelease.published_at ?? commit.date;
      }
    }

    latestRelease.fetched_at = fetchedAtTimestamp;
    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch GitLab releases for ${projectPath}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

type CodebergReleaseApi = {
  id: number;
  html_url?: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  created_at: string;
  published_at: string | null;
  prerelease?: boolean;
  draft?: boolean;
};

type CodebergTagApi = {
  name: string;
  message?: string | null;
  commit?: {
    sha?: string | null;
    id?: string | null;
    url?: string | null;
  } | null;
};

type CodebergCommitApi = {
  message?: string | null;
  author?: { date?: string | null } | null;
  committer?: { date?: string | null } | null;
  commit?: {
    message?: string | null;
    committer?: { date?: string | null } | null;
  } | null;
};

type CodebergRepoApi = {
  has_releases?: boolean | null;
  release_counter?: number | null;
};

function extractCodebergTagCommitSha(tag: CodebergTagApi): string | undefined {
  const commit = tag.commit;
  const sha =
    (typeof commit?.sha === "string" && commit.sha.trim()) ||
    (typeof commit?.id === "string" && commit.id.trim()) ||
    undefined;
  if (sha) return sha;

  if (typeof commit?.url === "string") {
    try {
      const url = new URL(commit.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts.at(-1);
      if (last) return last;
    } catch {
      // ignore
    }
  }

  return undefined;
}

function buildCodebergAuthChain(
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
): Array<{ mode: AuthMode; options: RequestInit }> {
  const chain: Array<{ mode: AuthMode; options: RequestInit }> = [];

  if (authToken) {
    chain.push({
      mode: "token",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `token ${authToken}`,
        },
        cache: "no-store",
      },
    });
    chain.push({
      mode: "bearer",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
      },
    });
  }

  chain.push({
    mode: "none",
    options: { headers: headersWithoutAuth, cache: "no-store" },
  });

  return chain;
}

async function tryFetchCodebergCommitMessage(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const candidates = [
    `${apiBaseUrl}/commits/${refOrSha}`,
    `${apiBaseUrl}/git/commits/${refOrSha}`,
  ];

  const chain = buildCodebergAuthChain(headersWithoutAuth, authToken);

  for (const url of candidates) {
    try {
      const { response, data } =
        await fetchJsonResponseWithRetryAuthChain<CodebergCommitApi>(
          url,
          chain,
          { description: `Codeberg commit (${refOrSha})` },
        );
      if (!response.ok || !data) continue;

      const message: string | undefined =
        typeof data.message === "string"
          ? data.message
          : typeof data.commit?.message === "string"
            ? data.commit.message
            : undefined;

      const date: string | undefined =
        typeof data.author?.date === "string"
          ? data.author.date
          : typeof data.committer?.date === "string"
            ? data.committer.date
            : typeof data.commit?.committer?.date === "string"
              ? data.commit.committer.date
              : undefined;

      if (message) return { message, date };
    } catch {
      // best-effort only
    }
  }

  return null;
}

async function fetchCodebergRepoInfo(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
  owner: string,
  repo: string,
): Promise<
  | { ok: true; data: CodebergRepoApi }
  | { ok: false; status: number; statusText: string }
> {
  const chain = buildCodebergAuthChain(headersWithoutAuth, authToken);

  const { response, data } =
    await fetchJsonResponseWithRetryAuthChain<CodebergRepoApi>(
      apiBaseUrl,
      chain,
      { description: `Codeberg repo info for ${owner}/${repo}` },
    );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
    };
  }

  return { ok: true, data: data ?? {} };
}

async function fetchLatestReleaseFromCodeberg(
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  log.info(`Fetching Codeberg release for ${owner}/${repo}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

  const CODEBERG_API_BASE_URL = `https://codeberg.org/api/v1/repos/${owner}/${repo}`;
  const MAX_PER_PAGE = 50;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;
  let tagFallbackReason: string | undefined;

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const codebergToken = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);

  try {
    for (let page = 1; page <= pagesToFetch; page++) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${CODEBERG_API_BASE_URL}/releases?limit=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      if (page === 1 && repoSettings.etag) {
        currentHeadersWithoutAuth["If-None-Match"] = repoSettings.etag;
      }

      const chain = buildCodebergAuthChain(
        currentHeadersWithoutAuth,
        codebergToken,
      );

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<CodebergReleaseApi[]>(
          url,
          chain,
          {
            description: `Codeberg releases for ${owner}/${repo} page ${page}`,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          log.info(`[ETag] No changes for codeberg:${owner}/${repo}.`);
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          // Codeberg (Gitea/Forgejo) may return 404 on the releases endpoint if releases are disabled,
          // even though the repository exists and tags are available.
          if (page === 1) {
            const repoInfo = await fetchCodebergRepoInfo(
              CODEBERG_API_BASE_URL,
              headersWithoutAuth,
              codebergToken,
              owner,
              repo,
            );

            if (repoInfo.ok) {
              tagFallbackReason = "releases_endpoint_404";
              break;
            }

            if (repoInfo.status === 404) {
              log.error(
                `Codeberg API error for ${owner}/${repo}: Not Found (404). The repository may not exist or is private.`,
              );
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }

            log.error(
              `Codeberg API error for ${owner}/${repo}: ${repoInfo.status} ${repoInfo.statusText}`,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }

          // For later pages, a 404 can happen if pagination exceeds available pages. Treat it as end.
          break;
        }
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get("retry-after"))
        ) {
          const retryAfter = response.headers.get("retry-after") ?? "N/A";
          log.error(
            `Codeberg API rate limit exceeded for ${owner}/${repo}. Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `Codeberg API error for ${owner}/${repo}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `Codeberg API returned an empty body for ${owner}/${repo} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases.map((r) => ({
          id: r.id,
          html_url:
            r.html_url ??
            `https://codeberg.org/${owner}/${repo}/releases/tag/${r.tag_name}`,
          tag_name: r.tag_name,
          name: r.name,
          body: r.body,
          created_at: r.created_at,
          published_at: r.published_at,
          prerelease: !!r.prerelease,
          draft: !!r.draft,
        })),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      const reason = tagFallbackReason ?? "no_formal_releases";
      log.info(
        `Codeberg releases unavailable for codeberg:${owner}/${repo} (reason=${reason}). Falling back to tags.`,
      );

      const tagUrls = [
        `${CODEBERG_API_BASE_URL}/tags?limit=1&page=1`,
        `${CODEBERG_API_BASE_URL}/tags?per_page=1&page=1`,
        `${CODEBERG_API_BASE_URL}/tags`,
      ];

      let tagsResponse: Response | null = null;
      let tags: CodebergTagApi[] | undefined;

      for (const tagUrl of tagUrls) {
        try {
          const tagChain = buildCodebergAuthChain(
            headersWithoutAuth,
            codebergToken,
          );

          const result = await fetchJsonResponseWithRetryAuthChain<
            CodebergTagApi[]
          >(tagUrl, tagChain, {
            description: `Codeberg tags for ${owner}/${repo}`,
          });

          tagsResponse = result.response;
          if (!tagsResponse.ok) {
            continue;
          }

          const received = result.data ?? [];
          if (received.length > 0) {
            tags = received;
            break;
          }
        } catch {
          // Try the next candidate URL
        }
      }

      if (!tagsResponse?.ok) {
        log.error(
          `Failed to fetch tags for codeberg:${owner}/${repo} after failing to find releases.`,
        );
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      if (!tags || tags.length === 0) {
        log.info(`No tags found for codeberg:${owner}/${repo}.`);
        return { release: null, error: { type: "no_releases_found" }, newEtag };
      }

      const latestTag = tags[0];
      const t = await getTranslations({ locale, namespace: "Actions" });

      let bodyContent = "";
      let publicationDate = new Date().toISOString();

      const sha = extractCodebergTagCommitSha(latestTag);
      if (sha) {
        const commit = await tryFetchCodebergCommitMessage(
          CODEBERG_API_BASE_URL,
          headersWithoutAuth,
          codebergToken,
          sha,
        );
        if (commit?.message) {
          bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
        }
        if (commit?.date) {
          publicationDate = commit.date;
        }
      }

      if (!bodyContent && typeof latestTag.message === "string") {
        bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${latestTag.message}`;
      }

      const virtualRelease: GithubRelease = {
        id: 0,
        html_url: `https://codeberg.org/${owner}/${repo}/src/tag/${latestTag.name}`,
        tag_name: latestTag.name,
        name: `Tag: ${latestTag.name}`,
        body: bodyContent,
        created_at: publicationDate,
        published_at: publicationDate,
        prerelease: false,
        draft: false,
      };
      allReleases = [virtualRelease];
    }

    const filteredReleases = allReleases.filter((r) => {
      try {
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, "i");
          if (exclude.test(r.tag_name)) return false;
        }
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, "i");
          return include.test(r.tag_name);
        }
      } catch (e) {
        log.error(
          `Invalid regex for repo codeberg:${owner}/${repo}. Regex filters will be ignored. Error:`,
          e,
        );
      }

      if (r.draft) {
        return effectiveReleaseChannels.includes("draft");
      }

      const isTagMarkedPreRelease = isPreReleaseByTagName(
        r.tag_name,
        allPreReleaseTypes,
      );
      const isConsideredPreRelease = r.prerelease || isTagMarkedPreRelease;

      if (isConsideredPreRelease) {
        if (!effectiveReleaseChannels.includes("prerelease")) return false;

        // If the tag explicitly includes a pre-release marker (e.g. -beta/-rc),
        // apply the configured sub-channel filter. Otherwise, fall back to the API flag.
        if (isTagMarkedPreRelease) {
          return isPreReleaseByTagName(
            r.tag_name,
            effectivePreReleaseSubChannels,
          );
        }

        return true;
      }

      return effectiveReleaseChannels.includes("stable");
    });

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      const commit = await tryFetchCodebergCommitMessage(
        CODEBERG_API_BASE_URL,
        headersWithoutAuth,
        codebergToken,
        latestRelease.tag_name,
      );
      if (commit?.message) {
        const t = await getTranslations({ locale, namespace: "Actions" });
        latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
      }
      if (commit?.date) {
        latestRelease.published_at = latestRelease.published_at ?? commit.date;
      }
    }

    latestRelease.fetched_at = fetchedAtTimestamp;
    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch Codeberg releases for ${owner}/${repo}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}

async function fetchLatestReleaseWithCache(
  provider: RepoProvider,
  providerHost: string | undefined,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean },
): Promise<LatestReleaseFetchResult> {
  const fetcher =
    provider === "github"
      ? fetchLatestReleaseFromGitHub
      : provider === "gitlab"
        ? (
            ownerArg: string,
            repoArg: string,
            repoSettingsArg: RepoSettingsForFetch,
            globalSettingsArg: AppSettings,
            localeArg: string,
          ) =>
            fetchLatestReleaseFromGitLab(
              providerHost ?? "gitlab.com",
              ownerArg,
              repoArg,
              repoSettingsArg,
              globalSettingsArg,
              localeArg,
            )
        : fetchLatestReleaseFromCodeberg;

  const cacheIntervalMinutes = getEffectiveCacheIntervalMinutes(
    repoSettings,
    globalSettings,
  );

  if (cacheIntervalMinutes <= 0 || options?.skipCache) {
    return fetcher(owner, repo, repoSettings, globalSettings, locale);
  }

  const cacheIntervalSeconds = cacheIntervalMinutes * 60;

  const effectiveReleasesPerPage =
    typeof repoSettings.releasesPerPage === "number" &&
    repoSettings.releasesPerPage >= 1 &&
    repoSettings.releasesPerPage <= 1000
      ? repoSettings.releasesPerPage
      : globalSettings.releasesPerPage;

  const cacheKeyPrefix =
    provider === "github"
      ? "github-release"
      : provider === "gitlab"
        ? `gitlab-release-${providerHost ?? "gitlab.com"}`
        : "codeberg-release";

  const cacheTag =
    provider === "github"
      ? "github-releases"
      : provider === "gitlab"
        ? "gitlab-releases"
        : "codeberg-releases";

  const cachedFetch = unstable_cache(
    (
      providerArg,
      providerHostArg,
      ownerArg,
      repoArg,
      repoSettingsArg,
      globalSettingsArg,
      localeArg,
    ) =>
      providerArg === "github"
        ? fetchLatestReleaseFromGitHub(
            ownerArg,
            repoArg,
            repoSettingsArg,
            globalSettingsArg,
            localeArg,
          )
        : providerArg === "gitlab"
          ? fetchLatestReleaseFromGitLab(
              providerHostArg,
              ownerArg,
              repoArg,
              repoSettingsArg,
              globalSettingsArg,
              localeArg,
            )
          : fetchLatestReleaseFromCodeberg(
              ownerArg,
              repoArg,
              repoSettingsArg,
              globalSettingsArg,
              localeArg,
            ),
    [
      cacheKeyPrefix,
      provider,
      providerHost ?? "gitlab.com",
      owner,
      repo,
      locale,
      JSON.stringify(repoSettings),
      String(effectiveReleasesPerPage),
      String(cacheIntervalMinutes),
    ],
    {
      revalidate: cacheIntervalSeconds,
      tags: [cacheTag],
    },
  );

  return cachedFetch(
    provider,
    providerHost ?? "gitlab.com",
    owner,
    repo,
    repoSettings,
    globalSettings,
    locale,
  );
}

export async function getLatestReleasesForRepos(
  repositories: Repository[],
  settings: AppSettings,
  locale: string,
  options?: { skipCache?: boolean },
): Promise<EnrichedRelease[]> {
  if (repositories.length === 0) {
    return [];
  }

  const configuredParallel = resolveParallelRepoFetches(settings);
  const effectiveBatchSize = Math.min(configuredParallel, repositories.length);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Fetching ${repositories.length} repositories with parallel batch size ${effectiveBatchSize} (configured=${configuredParallel}, GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const buildEnrichedRelease = async (
    repo: Repository,
  ): Promise<EnrichedRelease> => {
    const parsed = parseSupportedRepoUrl(repo.url);
    if (!parsed) {
      log.warn(`Skipping invalid repository URL for repoId=${repo.id}`);
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: "invalid_url" },
        isNew: repo.isNew,
      };
    }

    const repoSettings = {
      releaseChannels: repo.releaseChannels,
      preReleaseSubChannels: repo.preReleaseSubChannels,
      releasesPerPage: repo.releasesPerPage,
      refreshInterval: repo.refreshInterval,
      cacheInterval: repo.cacheInterval,
      backgroundCheckCron: repo.backgroundCheckCron,
      includeRegex: repo.includeRegex,
      excludeRegex: repo.excludeRegex,
      appriseTags: repo.appriseTags,
      appriseFormat: repo.appriseFormat,
      etag: repo.etag,
      latestRelease: repo.latestRelease,
    };

    const {
      release: latestRelease,
      error,
      newEtag,
    } = await fetchLatestReleaseWithCache(
      parsed.provider,
      parsed.providerHost,
      parsed.owner,
      parsed.repo,
      repoSettings,
      settings,
      locale,
      options,
    );

    if (error?.type === "not_modified") {
      const cached: CachedRelease | undefined = repo.latestRelease;
      const reconstructedRelease: GithubRelease | undefined = cached
        ? {
            ...cached,
            id: 0,
            prerelease: false,
            draft: false,
          }
        : undefined;

      if (reconstructedRelease) {
        reconstructedRelease.fetched_at = new Date().toISOString();
      }

      return {
        repoId: repo.id,
        repoUrl: repo.url,
        release: reconstructedRelease,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    if (error) {
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: error,
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    if (!latestRelease) {
      return {
        repoId: repo.id,
        repoUrl: repo.url,
        error: { type: "api_error" },
        isNew: repo.isNew,
        repoSettings: repoSettings,
        newEtag: newEtag,
      };
    }

    return {
      repoId: repo.id,
      repoUrl: repo.url,
      release: latestRelease,
      isNew: repo.isNew,
      repoSettings: repoSettings,
      newEtag: newEtag,
    };
  };

  const results: EnrichedRelease[] = new Array(repositories.length);

  for (
    let start = 0;
    start < repositories.length;
    start += effectiveBatchSize
  ) {
    const batch = repositories.slice(start, start + effectiveBatchSize);
    await Promise.all(
      batch.map(async (repo, offset) => {
        const result = await buildEnrichedRelease(repo);
        results[start + offset] = result;
      }),
    );
  }

  return results;
}

export async function addRepositoriesAction(
  _prevState: unknown,
  formData: FormData,
): Promise<{
  success: boolean;
  toast?: { title: string; description: string };
  error?: string;
  jobId?: string;
}> {
  return scheduleTask("addRepositoriesAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "RepositoryForm" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    const urls = formData.get("urls");
    if (typeof urls !== "string" || !urls.trim()) {
      return {
        success: false,
        error: t("toast_fail_description_manual", { failed: 1 }),
      };
    }

    const urlList = urls.split("\n").filter((u) => u.trim() !== "");
    const newRepos: Repository[] = [];
    let failedCount = 0;

    for (const url of urlList) {
      const parsed = parseSupportedRepoUrl(url);
      if (parsed) {
        newRepos.push({
          id: parsed.id,
          url: parsed.canonicalRepoUrl,
        });
      } else {
        failedCount++;
      }
    }

    if (newRepos.length === 0 && failedCount > 0) {
      return {
        success: false,
        error: t("toast_fail_description_manual", { failed: failedCount }),
      };
    }

    try {
      const currentRepos = await getRepositories();
      const existingIds = new Set(currentRepos.map((r) => r.id));
      const uniqueNewRepos = newRepos.filter((r) => !existingIds.has(r.id));
      let jobId: string | undefined;

      if (uniqueNewRepos.length > 0) {
        await saveRepositories([...currentRepos, ...uniqueNewRepos]);
        revalidatePath("/");

        jobId = crypto.randomUUID();
        setJobStatus(jobId, "pending");
        trackBackgroundTask(
          refreshMultipleRepositoriesAction(
            uniqueNewRepos.map((r) => r.id),
            jobId,
          ),
        );
      }

      const addedCount = uniqueNewRepos.length;
      const skippedCount = newRepos.length - addedCount;

      log.info(
        `Add repositories: added=${addedCount} skipped=${skippedCount} failed=${failedCount}`,
      );
      if (addedCount > 0 && jobId) {
        log.debug(
          `Queued background refresh jobId=${jobId} for ${addedCount} repos`,
        );
      }

      return {
        success: true,
        toast: {
          title: t("toast_success_title"),
          description: t("toast_success_description_manual", {
            added: addedCount,
            skipped: skippedCount,
            failed: failedCount,
          }),
        },
        jobId: addedCount > 0 ? jobId : undefined,
      };
    } catch (error: unknown) {
      log.error("Failed to add repositories:", error);
      return {
        success: false,
        error: t("toast_save_error_generic"),
      };
    }
  });
}

export async function importRepositoriesAction(
  importedData: Repository[],
): Promise<{
  success: boolean;
  message: string;
  jobId?: string;
}> {
  return scheduleTask("importRepositoriesAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "RepositoryForm" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, message: await getRestrictedActionError() };
    }
    const settings = await getSettings();

    try {
      const currentRepos = await getRepositories();
      const currentRepoIds = new Set(currentRepos.map((repo) => repo.id));
      const currentReposMap = new Map(currentRepos.map((r) => [r.id, r]));

      const validImportedRepos: Repository[] = [];
      for (const repo of importedData) {
        if (!repo.url) continue;
        const parsed = parseSupportedRepoUrl(repo.url);
        if (!parsed) continue;

        // Normalize id/url on import so GitHub/Codeberg repos remain stable even if
        // the exported data contained variations (trailing paths, `.git`, etc).
        validImportedRepos.push({
          ...repo,
          id: parsed.id,
          url: parsed.canonicalRepoUrl,
        });
      }

      let addedCount = 0;
      let updatedCount = 0;
      const reposToFetch: Repository[] = [];

      for (const importedRepo of validImportedRepos) {
        if (currentRepoIds.has(importedRepo.id)) {
          updatedCount++;
        } else {
          addedCount++;
        }

        const repoToSave: Repository = {
          ...currentReposMap.get(importedRepo.id),
          ...importedRepo,
          isNew:
            (settings.showAcknowledge ?? true)
              ? (importedRepo.isNew ?? false)
              : false,
        };
        currentReposMap.set(importedRepo.id, repoToSave);
        reposToFetch.push(repoToSave);
      }

      const finalList = Array.from(currentReposMap.values());
      await saveRepositories(finalList);
      revalidatePath("/");

      let jobId: string | undefined;
      if (reposToFetch.length > 0) {
        jobId = crypto.randomUUID();
        setJobStatus(jobId, "pending");
        const repoIds = reposToFetch.map((r) => r.id);
        trackBackgroundTask(refreshMultipleRepositoriesAction(repoIds, jobId));
      }

      log.info(
        `Import repositories: added=${addedCount} updated=${updatedCount}`,
      );
      return {
        success: true,
        message: t("toast_import_success_description", {
          addedCount,
          updatedCount,
        }),
        jobId: reposToFetch.length > 0 ? jobId : undefined,
      };
    } catch (error: unknown) {
      log.error("Failed to import repositories:", error);
      return {
        success: false,
        message: t("toast_save_error_generic"),
      };
    }
  });
}

export async function refreshSingleRepositoryAction(repoId: string) {
  return scheduleTask(`refreshSingleRepositoryAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return;
    }

    if (!isValidRepoId(repoId)) {
      log.error("Invalid repoId format for refresh:", repoId);
      return;
    }

    log.info(`Refreshing single repository: ${repoId}`);

    const settings = await getSettings();
    const locale = settings.locale;
    const allRepos = await getRepositories();
    const repoToRefresh = allRepos.find((r) => r.id === repoId);

    if (!repoToRefresh) {
      log.error(`Repository ${repoId} not found for refresh.`);
      return;
    }

    const enrichedReleases = await getLatestReleasesForRepos(
      [repoToRefresh],
      settings,
      locale,
      { skipCache: true },
    );

    const enrichedRelease = enrichedReleases[0];
    if (!enrichedRelease) {
      log.error(`Failed to get release for ${repoId} during single refresh.`);
      return;
    }

    const repoIndex = allRepos.findIndex((r) => r.id === repoId);
    if (repoIndex === -1) return; // Should not happen

    applyEtagUpdate(allRepos[repoIndex], enrichedRelease.newEtag);
    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0;
      const newCached = toCachedRelease(enrichedRelease.release);
      // Avoid overwriting existing real release data with virtual (tag-fallback) data
      if (
        !isVirtual ||
        canReplaceCachedReleaseWithVirtual(allRepos[repoIndex].latestRelease)
      ) {
        allRepos[repoIndex].latestRelease = newCached;
      } else if (
        isVirtual &&
        allRepos[repoIndex].latestRelease &&
        newCached.fetched_at
      ) {
        // Update last successful fetch time on 304 not modified
        allRepos[repoIndex].latestRelease.fetched_at = newCached.fetched_at;
      }
    }

    await saveRepositories(allRepos);
    revalidatePath("/"); // Revalidate the home page to show the new data
  });
}

export async function refreshMultipleRepositoriesAction(
  repoIds: string[],
  jobId: string,
) {
  try {
    log.info(
      `Refresh multiple repositories start: count=${repoIds.length} jobId=${jobId}`,
    );
    const settings = await getSettings();
    const locale = settings.locale;
    const allRepos = await getRepositories();
    const reposToRefresh = allRepos.filter((r) => repoIds.includes(r.id));

    if (reposToRefresh.length > 0) {
      const enrichedReleases = await getLatestReleasesForRepos(
        reposToRefresh,
        settings,
        locale,
        { skipCache: true },
      );

      const enrichedMap = new Map(enrichedReleases.map((r) => [r.repoId, r]));

      const updatedRepos = allRepos.map((repo) => {
        const enriched = enrichedMap.get(repo.id);
        if (enriched) {
          if (enriched.release) {
            const isVirtual = enriched.release.id === 0;
            const newCached = toCachedRelease(enriched.release);
            // Avoid overwriting existing real release data with virtual (tag-fallback) data
            if (
              !isVirtual ||
              canReplaceCachedReleaseWithVirtual(repo.latestRelease)
            ) {
              repo.latestRelease = newCached;
            } else if (
              isVirtual &&
              repo.latestRelease &&
              newCached.fetched_at
            ) {
              // Update last successful fetch time on 304 not modified
              repo.latestRelease.fetched_at = newCached.fetched_at;
            }
            // Do not initialize lastSeenReleaseTag from a virtual (tag-fallback) release
            if (!repo.lastSeenReleaseTag && !isVirtual) {
              repo.lastSeenReleaseTag = enriched.release.tag_name;
            }
          }
          applyEtagUpdate(repo, enriched.newEtag);
        }
        return repo;
      });
      await saveRepositories(updatedRepos);
    }
    setJobStatus(jobId, "complete");
    log.info(`Refresh multiple repositories complete: jobId=${jobId}`);
  } catch (error) {
    log.error(`[Job ${jobId}] Failed to refresh repositories:`, error);
    setJobStatus(jobId, "error");
  }
}

export async function removeRepositoryAction(repoId: string) {
  return scheduleTask(`removeRepositoryAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return;
    }

    if (!isValidRepoId(repoId)) {
      log.error("Invalid repoId format for removal:", repoId);
      return;
    }
    const currentRepos = await getRepositories();
    const newRepos = currentRepos.filter((r) => r.id !== repoId);
    await saveRepositories(newRepos);
    log.info(`Removed repository: ${repoId}`);
    revalidatePath("/");
  });
}

export async function acknowledgeNewReleaseAction(
  repoId: string,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`acknowledgeNewReleaseAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "ReleaseCard" });
    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex !== -1) {
        currentRepos[repoIndex].isNew = false;
        await saveRepositories(currentRepos);
        revalidatePath("/");
        log.info(`Acknowledged new release for ${repoId}`);
        return { success: true };
      }

      return { success: false, error: t("toast_acknowledge_error_not_found") };
    } catch (error: unknown) {
      log.error("Failed to acknowledge release:", error);
      return { success: false, error: t("toast_acknowledge_error_generic") };
    }
  });
}

export async function markAsNewAction(
  repoId: string,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`markAsNewAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "ReleaseCard" });
    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex !== -1) {
        currentRepos[repoIndex].isNew = true;
        await saveRepositories(currentRepos);
        revalidatePath("/");
        log.info(`Marked release as new for ${repoId}`);
        return { success: true };
      }

      return { success: false, error: t("toast_mark_as_new_error_not_found") };
    } catch (error: unknown) {
      log.error("Failed to mark release as new:", error);
      return { success: false, error: t("toast_mark_as_new_error_generic") };
    }
  });
}

async function _checkForNewReleasesUnscheduled(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  log.info(`Running check for new releases...`);
  const settings = await getSettings();
  const backgroundCheckStartedAt = new Date();
  const backgroundCheckStartedAtIso = backgroundCheckStartedAt.toISOString();
  const effectiveLocale = options?.overrideLocale || settings.locale;
  const parallelLimit = resolveParallelRepoFetches(settings);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Parallel fetch batch size set to ${parallelLimit} (GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const originalRepos = await getRepositories();
  if (originalRepos.length === 0) {
    log.info(`No repositories to check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const reposToCheck = options?.onlyDue
    ? filterRepositoriesDueForBackgroundCheck(
        originalRepos,
        settings,
        backgroundCheckStartedAt,
      )
    : originalRepos;

  if (reposToCheck.length === 0) {
    log.info(`No repositories are due for background check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    reposToCheck,
    settings,
    effectiveLocale,
    { skipCache: options?.skipCache },
  );

  const updatedRepos = [...originalRepos];
  let changed = false;
  let notificationsSent = 0;

  for (const enrichedRelease of enrichedReleases) {
    const repoIndex = updatedRepos.findIndex(
      (r) => r.id === enrichedRelease.repoId,
    );
    if (repoIndex === -1) continue;

    const repo = updatedRepos[repoIndex];
    let repoWasUpdated = false;

    if (
      options?.onlyDue &&
      repo.lastBackgroundCheckAt !== backgroundCheckStartedAtIso
    ) {
      repo.lastBackgroundCheckAt = backgroundCheckStartedAtIso;
      repoWasUpdated = true;
    }

    if (applyEtagUpdate(repo, enrichedRelease.newEtag)) {
      repoWasUpdated = true;
    }

    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0; // tag-fallback or reconstructed data
      const newCachedRelease = toCachedRelease(enrichedRelease.release);

      // Do not overwrite an existing real release with a virtual one.
      if (
        !isVirtual ||
        canReplaceCachedReleaseWithVirtual(repo.latestRelease)
      ) {
        if (
          JSON.stringify(repo.latestRelease) !==
          JSON.stringify(newCachedRelease)
        ) {
          repoWasUpdated = true;
        }
        repo.latestRelease = newCachedRelease;
      } else if (
        isVirtual &&
        repo.latestRelease &&
        newCachedRelease.fetched_at
      ) {
        // Still update the last successful fetch time when ETag says not modified
        if (repo.latestRelease.fetched_at !== newCachedRelease.fetched_at) {
          repo.latestRelease.fetched_at = newCachedRelease.fetched_at;
          repoWasUpdated = true;
        }
      }

      const newTag = enrichedRelease.release.tag_name;
      const isNewRelease =
        !isVirtual &&
        repo.lastSeenReleaseTag &&
        repo.lastSeenReleaseTag !== newTag;

      if (isNewRelease) {
        log.info(
          `New release detected for ${repo.id}: ${newTag} (previously ${repo.lastSeenReleaseTag})`,
        );

        const shouldHighlight = settings.showAcknowledge ?? true;
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = shouldHighlight;
        repoWasUpdated = true;

        try {
          await sendNotification(
            repo,
            enrichedRelease.release,
            effectiveLocale,
            settings,
          );
          notificationsSent++;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error ?? "unknown");
          log.error(
            `Failed to send notification for ${repo.id}. The release tag HAS been updated to prevent repeated failures for the same release. Error: ${message}`,
            error instanceof Error ? error : undefined,
          );
        }
      } else if (!repo.lastSeenReleaseTag && !isVirtual) {
        log.info(
          `First fetch for ${repo.id}, setting initial release tag to ${newTag}. No notification will be sent.`,
        );
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = false;
        repoWasUpdated = true;
      }
    }
    if (repoWasUpdated) {
      changed = true;
    }
  }

  if (changed) {
    log.info(`Found changes, updating repository data file.`);
    await saveRepositories(updatedRepos);
  } else {
    log.info(`No new releases found.`);
  }
  log.info(
    `Summary: notificationsSent=${notificationsSent} checked=${reposToCheck.length}`,
  );
  return { notificationsSent, checked: reposToCheck.length };
}

export async function checkForNewReleases(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  return scheduleTask("checkForNewReleases", () =>
    _checkForNewReleasesUnscheduled(options),
  );
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^v/i, "").replace(/\+.*$/, "");
}

function compareSemanticVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core, preRelease] = version.split("-", 2);
    const parts = core.split(".").map((part) => {
      const numeric = Number(part);
      return Number.isNaN(numeric) ? 0 : numeric;
    });
    return { parts, preRelease: preRelease ?? null };
  };

  const parsedA = parse(a);
  const parsedB = parse(b);
  const length = Math.max(parsedA.parts.length, parsedB.parts.length);

  for (let i = 0; i < length; i += 1) {
    const segmentA = parsedA.parts[i] ?? 0;
    const segmentB = parsedB.parts[i] ?? 0;
    if (segmentA > segmentB) return 1;
    if (segmentA < segmentB) return -1;
  }

  if (parsedA.preRelease && !parsedB.preRelease) return -1;
  if (!parsedA.preRelease && parsedB.preRelease) return 1;
  if (parsedA.preRelease && parsedB.preRelease) {
    if (parsedA.preRelease > parsedB.preRelease) return 1;
    if (parsedA.preRelease < parsedB.preRelease) return -1;
  }

  return 0;
}

export async function getUpdateNotificationState(): Promise<UpdateNotificationState> {
  const status = await getSystemStatus();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const latestVersion = status.latestKnownVersion;
  const normalizedCurrent = normalizeVersion(currentVersion);
  const normalizedLatest = normalizeVersion(latestVersion);

  let hasUpdate = false;

  if (normalizedCurrent && normalizedLatest) {
    hasUpdate =
      compareSemanticVersions(normalizedLatest, normalizedCurrent) === 1;
  } else if (latestVersion) {
    hasUpdate = latestVersion !== currentVersion;
  }

  const isDismissed =
    hasUpdate &&
    typeof status.dismissedVersion === "string" &&
    status.dismissedVersion === latestVersion;

  return {
    latestVersion,
    currentVersion,
    lastCheckedAt: status.lastCheckedAt,
    lastCheckError: status.lastCheckError,
    hasUpdate,
    isDismissed,
    shouldNotify: hasUpdate && !isDismissed,
  };
}

export async function dismissUpdateNotificationAction(): Promise<{
  success: boolean;
}> {
  return scheduleTask("dismissUpdateNotification", async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false };
    }

    await updateSystemStatus((current) => {
      const latestVersion = current.latestKnownVersion;
      if (!latestVersion) {
        return {
          ...current,
          dismissedVersion: null,
        };
      }
      return {
        ...current,
        dismissedVersion: latestVersion,
      };
    });
    return { success: true };
  });
}

export async function triggerAppUpdateCheckAction(): Promise<{
  success: boolean;
  notice: UpdateNotificationState;
}> {
  return scheduleTask("triggerAppUpdateCheck", async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, notice: await getUpdateNotificationState() };
    }

    await updateSystemStatus((current) => ({
      ...current,
      dismissedVersion: null,
    }));

    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
    await runApplicationUpdateCheck(currentVersion);
    const notice = await getUpdateNotificationState();
    return { success: true, notice };
  });
}

async function backgroundPollingLoop() {
  try {
    await checkForNewReleases({ skipCache: true, onlyDue: true });
  } catch (error) {
    log.error("Error during background check for new releases:", error);
  } finally {
    const pollingIntervalMs = 60 * 1000;

    log.info("Next background check scheduled in 1 minute.");
    setTimeout(backgroundPollingLoop, pollingIntervalMs);
  }
}

if (
  process.env.NODE_ENV === "production" &&
  !process.env.BACKGROUND_POLLING_INITIALIZED
) {
  log.info(`Initializing dynamic background polling.`);
  process.env.BACKGROUND_POLLING_INITIALIZED = "true";
  setTimeout(backgroundPollingLoop, 5000);
}

const UPDATE_CHECK_INTERVAL_MINUTES = 60;
const UPDATE_CHECK_INITIAL_DELAY_MS = 10_000;

async function backgroundUpdateCheckLoop() {
  const intervalMinutes = Math.max(UPDATE_CHECK_INTERVAL_MINUTES, 1);
  const intervalMs = intervalMinutes * 60 * 1000;
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

  try {
    await runApplicationUpdateCheck(currentVersion);
  } catch (error) {
    log.error("Error during application update check:", error);
  } finally {
    log.info(
      `Next application update check scheduled in ${intervalMinutes} minutes.`,
    );
    setTimeout(backgroundUpdateCheckLoop, intervalMs);
  }
}

if (
  process.env.NODE_ENV !== "test" &&
  !process.env.APP_UPDATE_CHECK_INITIALIZED
) {
  log.info("Initializing application update checker.");
  process.env.APP_UPDATE_CHECK_INITIALIZED = "true";
  setTimeout(backgroundUpdateCheckLoop, UPDATE_CHECK_INITIAL_DELAY_MS);
}

const TEST_REPO_ID = "test/test";

export async function setupTestRepositoryAction(): Promise<{
  success: boolean;
  message: string;
}> {
  return scheduleTask("setupTestRepositoryAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "TestPage" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, message: await getRestrictedActionError() };
    }

    // Prepare a readable title/body so the card renders nicely before the first check
    const { title, body } = await getComprehensiveMarkdownBody(locale);

    try {
      const currentRepos = await getRepositories();
      const testRepoIndex = currentRepos.findIndex(
        (r) => r.id === TEST_REPO_ID,
      );

      if (testRepoIndex > -1) {
        currentRepos[testRepoIndex].lastSeenReleaseTag = "v0.9.0-reset";
        currentRepos[testRepoIndex].isNew = false;
        // Ensure a cached release exists so the UI shows a proper card immediately
        currentRepos[testRepoIndex].latestRelease = {
          html_url: `https://github.com/${TEST_REPO_ID}/releases/tag/v0.9.0-reset`,
          tag_name: "v0.9.0-reset",
          name: title,
          body: body,
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        };
      } else {
        currentRepos.push({
          id: TEST_REPO_ID,
          url: `https://github.com/${TEST_REPO_ID}`,
          lastSeenReleaseTag: "v0.9.0-initial",
          isNew: false,
          latestRelease: {
            html_url: `https://github.com/${TEST_REPO_ID}/releases/tag/v0.9.0-initial`,
            tag_name: "v0.9.0-initial",
            name: title,
            body: body,
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            fetched_at: new Date().toISOString(),
          },
        });
      }

      await saveRepositories(currentRepos);
      revalidatePath("/");
      revalidatePath("/test");
      updateReleaseCacheTags();
      return { success: true, message: t("toast_setup_test_repo_success") };
    } catch (error: unknown) {
      log.error("setupTestRepositoryAction failed:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message || t("toast_setup_test_repo_error")
            : t("toast_setup_test_repo_error"),
      };
    }
  });
}

export async function triggerReleaseCheckAction(): Promise<{
  success: boolean;
  message: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, message: await getRestrictedActionError() };
  }

  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_FROM_ADDRESS,
    MAIL_TO_ADDRESS,
    APPRISE_URL,
  } = process.env;
  const isSmtpConfigured = !!(
    MAIL_HOST &&
    MAIL_PORT &&
    MAIL_FROM_ADDRESS &&
    MAIL_TO_ADDRESS
  );
  const isAppriseConfigured = !!APPRISE_URL;

  if (!isSmtpConfigured && !isAppriseConfigured) {
    return {
      success: false,
      message: t("toast_no_notification_service_configured"),
    };
  }

  try {
    const result = await checkForNewReleases({
      overrideLocale: locale,
      skipCache: true,
    });

    if (result && result.notificationsSent > 0) {
      return {
        success: true,
        message: t("toast_trigger_check_success_email_sent"),
      };
    } else {
      return {
        success: true,
        message: t("toast_trigger_check_success_no_email"),
      };
    }
  } catch (error: unknown) {
    log.error("triggerReleaseCheckAction failed:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message || t("toast_trigger_check_error")
          : t("toast_trigger_check_error"),
    };
  }
}

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

export async function sendTestEmailAction(customEmail: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  const tEmail = await getTranslations({ locale, namespace: "Email" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, error: await getRestrictedActionError() };
  }

  const trimmedEmail = customEmail.trim();
  const recipient = trimmedEmail || process.env.MAIL_TO_ADDRESS;

  const { MAIL_HOST, MAIL_PORT, MAIL_FROM_ADDRESS } = process.env;
  if (!MAIL_HOST || !MAIL_PORT || !MAIL_FROM_ADDRESS || !recipient) {
    return {
      success: false,
      error: tEmail("error_config_incomplete"),
    };
  }

  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return {
      success: false,
      error: t("invalid_email_format"),
    };
  }

  const testRepo: Repository = {
    id: "test/test",
    url: "https://github.com/test/test",
  };

  const { title, body } = await getComprehensiveMarkdownBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: "https://github.com/test/test/releases/tag/v1.0.0",
    tag_name: "v1.0.0-test",
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestEmail(
      testRepo,
      testRelease,
      locale,
      settings.timeFormat,
      recipient,
    );
    return { success: true };
  } catch (error: unknown) {
    log.error("sendTestEmailAction failed:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message || t("toast_email_error_description")
          : t("toast_email_error_description"),
    };
  }
}

export async function sendTestAppriseAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, error: await getRestrictedActionError() };
  }

  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    log.warn("sendTestAppriseAction called but APPRISE_URL is not configured");
    return {
      success: false,
      error: t("toast_apprise_not_configured_error"),
    };
  }

  const testRepo: Repository = {
    id: "test/test",
    url: "https://github.com/test/test",
  };

  const { title, body } = await getBasicAppriseTestBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: "https://github.com/test/test/releases/tag/v1.0.0",
    tag_name: "v1.0.0-test",
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestAppriseNotification(testRepo, testRelease, locale, settings);
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : String(error ?? "unknown"),
    };
  }
}

export async function checkAppriseStatusAction(): Promise<AppriseStatus> {
  if (!(await isRestrictedActionAllowed())) {
    return { status: "error", error: await getRestrictedActionError() };
  }

  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    return { status: "not_configured" };
  }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });

  try {
    const urlObject = new URL(APPRISE_URL);
    const statusUrl = `${urlObject.protocol}//${urlObject.host}/status`;

    const response = await fetch(statusUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      return { status: "ok" };
    } else {
      return {
        status: "error",
        error: t("apprise_connection_error_status", {
          status: response.status,
        }),
      };
    }
  } catch {
    return {
      status: "error",
      error: t("apprise_connection_error_fetch"),
    };
  }
}

export async function refreshAndCheckAction(): Promise<{
  success: boolean;
  messageKey: "toast_refresh_success_description" | "toast_refresh_found_new";
}> {
  const locale = await getLocale();
  if (!(await isRestrictedActionAllowed())) {
    throw new Error(await getRestrictedActionError());
  }

  log.info("Manual refresh triggered by user");
  const result = await checkForNewReleases({
    overrideLocale: locale,
    skipCache: true,
  });

  const messageKey =
    result.notificationsSent > 0
      ? "toast_refresh_found_new"
      : "toast_refresh_success_description";

  log.info(
    `Manual refresh result: notificationsSent=${result.notificationsSent} checked=${result.checked}`,
  );
  return { success: true, messageKey };
}

export async function refreshDueRepositoriesAction(): Promise<{
  success: boolean;
  checked: number;
}> {
  if (!(await isRestrictedActionAllowed())) {
    throw new Error(await getRestrictedActionError());
  }

  const result = await checkForNewReleases({
    skipCache: true,
    onlyDue: true,
  });

  return { success: true, checked: result.checked };
}

export async function getRepositoriesForExport(): Promise<{
  success: boolean;
  data?: Repository[];
  error?: string;
}> {
  try {
    const repos = await getRepositories();
    return { success: true, data: repos };
  } catch (error: unknown) {
    log.error("Failed to get repositories for export:", error);
    return { success: false, error: "Failed to read repository data." };
  }
}

export async function updateRepositorySettingsAction(
  repoId: string,
  settings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "refreshInterval"
    | "cacheInterval"
    | "backgroundCheckCron"
    | "includeRegex"
    | "excludeRegex"
    | "appriseTags"
    | "appriseFormat"
  >,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`updateRepositorySettingsAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }

    const locale = await getLocale();
    const t = await getTranslations({
      locale,
      namespace: "RepoSettingsDialog",
    });

    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex === -1) {
        return { success: false, error: t("toast_error_not_found") };
      }

      const existing = currentRepos[repoIndex];

      const prevInclude = (existing.includeRegex ?? "").trim() || undefined;
      const prevExclude = (existing.excludeRegex ?? "").trim() || undefined;
      const newInclude = (settings.includeRegex ?? "").trim() || undefined;
      const newExclude = (settings.excludeRegex ?? "").trim() || undefined;
      const cronInput = (settings.backgroundCheckCron ?? "").trim();
      const newBackgroundCheckCron = cronInput
        ? normalizeBackgroundCheckCron(cronInput)
        : undefined;

      if (cronInput && !newBackgroundCheckCron) {
        return { success: false, error: t("cron_error_invalid") };
      }

      const newRefreshInterval = newBackgroundCheckCron
        ? null
        : typeof settings.refreshInterval === "number"
          ? (normalizeRefreshInterval(settings.refreshInterval) ?? null)
          : null;
      const newCacheInterval =
        typeof settings.cacheInterval === "number"
          ? (normalizeCacheInterval(settings.cacheInterval) ?? null)
          : null;

      const filtersChanged =
        prevInclude !== newInclude || prevExclude !== newExclude;

      // Normalize arrays for comparison (treat empty array as undefined/global)
      const normArray = <T>(arr?: T[] | null) => {
        if (!arr || arr.length === 0) return undefined;
        return [...arr].sort();
      };
      const prevChannels = normArray(existing.releaseChannels);
      const newChannels = normArray(settings.releaseChannels);
      const channelsChanged =
        JSON.stringify(prevChannels) !== JSON.stringify(newChannels);

      const prevPreSubs = normArray(existing.preReleaseSubChannels);
      const newPreSubs = normArray(settings.preReleaseSubChannels);
      const preSubsChanged =
        JSON.stringify(prevPreSubs) !== JSON.stringify(newPreSubs);

      const prevRpp = existing.releasesPerPage ?? undefined;
      const newRpp = settings.releasesPerPage ?? undefined;
      const rppChanged = prevRpp !== newRpp;
      const refreshIntervalChanged =
        (existing.refreshInterval ?? null) !== newRefreshInterval;
      const cacheIntervalChanged =
        (existing.cacheInterval ?? null) !== newCacheInterval;
      const backgroundCheckCronChanged =
        (existing.backgroundCheckCron ?? undefined) !== newBackgroundCheckCron;

      // Build change summary for logging
      const changes: string[] = [];
      const fmt = (value: unknown) =>
        value === undefined ? "undefined" : JSON.stringify(value);
      const cmpArr = (a?: unknown[] | null, b?: unknown[] | null) =>
        JSON.stringify((a || []).slice().sort()) ===
        JSON.stringify((b || []).slice().sort());
      if (!cmpArr(existing.releaseChannels, settings.releaseChannels)) {
        changes.push(
          `releaseChannels: ${fmt(existing.releaseChannels)} -> ${fmt(settings.releaseChannels)}`,
        );
      }
      if (
        !cmpArr(existing.preReleaseSubChannels, settings.preReleaseSubChannels)
      ) {
        changes.push(
          `preReleaseSubChannels: ${fmt(existing.preReleaseSubChannels)} -> ${fmt(settings.preReleaseSubChannels)}`,
        );
      }
      if (
        (existing.releasesPerPage ?? undefined) !==
        (settings.releasesPerPage ?? undefined)
      ) {
        changes.push(
          `releasesPerPage: ${fmt(existing.releasesPerPage)} -> ${fmt(settings.releasesPerPage)}`,
        );
      }
      if (refreshIntervalChanged) {
        changes.push(
          `refreshInterval: ${fmt(existing.refreshInterval)} -> ${fmt(newRefreshInterval)}`,
        );
      }
      if (cacheIntervalChanged) {
        changes.push(
          `cacheInterval: ${fmt(existing.cacheInterval)} -> ${fmt(newCacheInterval)}`,
        );
      }
      if (backgroundCheckCronChanged) {
        changes.push(
          `backgroundCheckCron: ${fmt(existing.backgroundCheckCron)} -> ${fmt(newBackgroundCheckCron)}`,
        );
      }
      if (prevInclude !== newInclude) {
        changes.push(`includeRegex: ${fmt(prevInclude)} -> ${fmt(newInclude)}`);
      }
      if (prevExclude !== newExclude) {
        changes.push(`excludeRegex: ${fmt(prevExclude)} -> ${fmt(newExclude)}`);
      }
      if (
        (existing.appriseTags ?? undefined) !==
        (settings.appriseTags ?? undefined)
      ) {
        changes.push(
          `appriseTags: ${fmt(existing.appriseTags)} -> ${fmt(settings.appriseTags)}`,
        );
      }
      if (
        (existing.appriseFormat ?? undefined) !==
        (settings.appriseFormat ?? undefined)
      ) {
        changes.push(
          `appriseFormat: ${fmt(existing.appriseFormat)} -> ${fmt(settings.appriseFormat)}`,
        );
      }

      const etagInvalidated =
        filtersChanged || channelsChanged || preSubsChanged || rppChanged;

      currentRepos[repoIndex] = {
        ...existing,
        releaseChannels: settings.releaseChannels,
        preReleaseSubChannels: settings.preReleaseSubChannels,
        releasesPerPage: settings.releasesPerPage,
        refreshInterval: newRefreshInterval,
        cacheInterval: newCacheInterval,
        backgroundCheckCron: newBackgroundCheckCron,
        lastBackgroundCheckAt: backgroundCheckCronChanged
          ? undefined
          : existing.lastBackgroundCheckAt,
        includeRegex: newInclude,
        excludeRegex: newExclude,
        appriseTags: settings.appriseTags,
        appriseFormat: settings.appriseFormat,
        // Invalidate ETag when filters/pagination that affect visible latest release change
        etag: etagInvalidated ? undefined : existing.etag,
      };

      await saveRepositories(currentRepos);
      revalidatePath("/");
      if (etagInvalidated) {
        const reasons: string[] = [];
        if (filtersChanged) reasons.push("filtersChanged");
        if (channelsChanged) reasons.push("releaseChannelsChanged");
        if (preSubsChanged) reasons.push("preReleaseSubChannelsChanged");
        if (rppChanged) reasons.push("releasesPerPageChanged");
        log.info(`Cleared ETag for ${repoId} due to: ${reasons.join(", ")}`);
      }
      if (changes.length > 0) {
        log.info(
          `Updated repository settings for ${repoId}: ${changes.join("; ")}`,
        );
      } else {
        log.info(`Updated repository settings for ${repoId}: no changes.`);
      }
      return { success: true };
    } catch (error: unknown) {
      log.error(`Failed to update settings for ${repoId}:`, error);
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      return {
        success: false,
        error: message || t("toast_error_generic"),
      };
    }
  });
}

export async function revalidateReleasesAction() {
  updateReleaseCacheTags();
}

export async function getJobStatusAction(
  jobId: string,
): Promise<{ status: JobStatus | undefined }> {
  return { status: getJobStatus(jobId) };
}

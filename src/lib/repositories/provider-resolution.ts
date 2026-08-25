import { mapWithConcurrency } from "@/lib/concurrency";
import { discardResponseWithTimeout } from "@/lib/http/fetch-with-timeout";
import {
  buildForgejoAuthChain,
  buildGitlabAuthChain,
} from "@/lib/releases/auth-chains";
import {
  fetchJsonResponseWithRetryAuthChain,
  fetchResponseWithRetryAuthChain,
  fetchWithRetry,
} from "@/lib/releases/fetch";
import { MAX_PROVIDER_RESOLUTION_BATCH_SIZE } from "@/lib/repositories/provider-resolution-limits";
import {
  buildForgejoRepoId,
  getAllowedForgejoBaseUrls,
  getAllowedGitlabHosts,
  getForgejoAccessTokensByBaseUrl,
  getGitlabAuthForHost,
  hasAnyGitlabTokenForAllowedHosts,
  normalizeRepoName,
  type ParsedRepoUrl,
} from "@/lib/repositories/providers";
import {
  isRestrictedActionAllowed,
  log,
  normalizeEnvToken,
} from "@/lib/server-action-helpers";

type RepoProviderResolutionCandidate = Pick<
  ParsedRepoUrl,
  "provider" | "providerHost" | "providerBaseUrl" | "id" | "canonicalRepoUrl"
>;

export type RepoProviderResolution = {
  input: string;
  candidates: RepoProviderResolutionCandidate[];
};

const PROVIDER_RESOLUTION_CONCURRENCY = 4;
const MAX_PROVIDER_RESOLUTION_INPUT_LENGTH = 256;

type ForgejoRepositoryApi = {
  name?: unknown;
  full_name?: unknown;
  owner?: {
    login?: unknown;
    username?: unknown;
  } | null;
};

export { MAX_PROVIDER_RESOLUTION_BATCH_SIZE } from "@/lib/repositories/provider-resolution-limits";

function isValidProviderResolutionInput(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PROVIDER_RESOLUTION_INPUT_LENGTH
  );
}

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

async function lookupGithubCandidate(
  owner: string,
  repo: string,
): Promise<RepoProviderResolutionCandidate | null> {
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
    await discardResponseWithTimeout(response);
    if (!response.ok) return null;

    return {
      provider: "github",
      id: `github:${owner}/${repo}`.toLowerCase(),
      canonicalRepoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch (error) {
    log.debug(`GitHub repo lookup threw for ${owner}/${repo}:`, error);
    return null;
  }
}

async function lookupCodebergCandidate(
  owner: string,
  repo: string,
): Promise<RepoProviderResolutionCandidate | null> {
  try {
    const headersWithoutAuth: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "GitHubReleaseMonitorApp",
    };
    const codebergToken = normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN);
    const chain = buildForgejoAuthChain(headersWithoutAuth, codebergToken);
    const url = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const { response, mode } = await fetchResponseWithRetryAuthChain(
      url,
      chain,
      { description: `Codeberg repo lookup for ${owner}/${repo}` },
    );
    log.debug(
      `Codeberg repo lookup for ${owner}/${repo}: ${response.status} ${response.statusText} (auth=${mode})`,
    );
    await discardResponseWithTimeout(response);
    if (!response.ok) return null;

    return {
      provider: "codeberg",
      id: `codeberg:${owner}/${repo}`.toLowerCase(),
      canonicalRepoUrl: `https://codeberg.org/${owner}/${repo}`,
    };
  } catch (error) {
    log.debug(`Codeberg repo lookup threw for ${owner}/${repo}:`, error);
    return null;
  }
}

async function lookupForgejoCandidate(
  owner: string,
  repo: string,
  baseUrl: string,
  token: string | null,
): Promise<RepoProviderResolutionCandidate | null> {
  try {
    const headersWithoutAuth: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "GitHubReleaseMonitorApp",
    };
    const chain = buildForgejoAuthChain(headersWithoutAuth, token);
    const url = `${baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const { response, data, mode } =
      await fetchJsonResponseWithRetryAuthChain<ForgejoRepositoryApi>(
        url,
        chain,
        {
          description: `Forgejo repo lookup for ${owner}/${repo} on ${baseUrl}`,
          allowedRedirectBaseUrl: baseUrl,
        },
      );
    log.debug(
      `Forgejo repo lookup for ${owner}/${repo} on ${baseUrl}: ${response.status} ${response.statusText} (auth=${mode})`,
    );
    if (!response.ok) {
      await discardResponseWithTimeout(response);
      return null;
    }

    const expectedOwner = owner.toLowerCase();
    const expectedRepo = repo.toLowerCase();
    const fullName =
      typeof data?.full_name === "string" ? data.full_name.trim() : "";
    const apiOwner =
      typeof data?.owner?.login === "string"
        ? data.owner.login.trim()
        : typeof data?.owner?.username === "string"
          ? data.owner.username.trim()
          : "";
    const apiRepo = typeof data?.name === "string" ? data.name.trim() : "";
    const matchesRequestedRepository = fullName
      ? fullName.toLowerCase() === `${expectedOwner}/${expectedRepo}`
      : apiOwner.toLowerCase() === expectedOwner &&
        apiRepo.toLowerCase() === expectedRepo;
    if (!matchesRequestedRepository) return null;

    return {
      provider: "forgejo",
      providerHost: new URL(baseUrl).host,
      providerBaseUrl: baseUrl,
      id: buildForgejoRepoId(baseUrl, owner, repo),
      canonicalRepoUrl: `${baseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    };
  } catch (error) {
    log.debug(
      `Forgejo repo lookup threw for ${owner}/${repo} on ${baseUrl}:`,
      error,
    );
    return null;
  }
}

async function lookupGitlabCandidate(
  owner: string,
  repo: string,
  gitlabHost: string,
): Promise<RepoProviderResolutionCandidate | null> {
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
    await discardResponseWithTimeout(response);
    if (!response.ok) return null;

    return {
      provider: "gitlab",
      providerHost: gitlabHost,
      id: `gitlab:${gitlabHost}/${projectPath}`.toLowerCase(),
      canonicalRepoUrl: `https://${gitlabHost}/${owner}/${repo}`,
    };
  } catch (error) {
    log.debug(
      `GitLab repo lookup threw for ${owner}/${repo} on ${gitlabHost}:`,
      error,
    );
    return null;
  }
}

async function resolveRepoProviders(
  input: string,
): Promise<RepoProviderResolutionCandidate[]> {
  const parsed = parseOwnerRepoShorthand(input);
  if (!parsed) {
    log.debug(
      `Repo provider resolution skipped (not shorthand input): ${input.trim()}`,
    );
    return [];
  }

  const { owner, repo } = parsed;
  const githubTokenConfigured = Boolean(
    normalizeEnvToken(process.env.GITHUB_ACCESS_TOKEN),
  );
  const codebergTokenConfigured = Boolean(
    normalizeEnvToken(process.env.CODEBERG_ACCESS_TOKEN),
  );
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  const gitlabHosts = getAllowedGitlabHosts();
  const forgejoBaseUrls = getAllowedForgejoBaseUrls();
  const forgejoTokens = getForgejoAccessTokensByBaseUrl();
  const forgejoTokenConfigured = forgejoTokens.size > 0;

  log.debug(
    `Resolving providers for shorthand repo ${owner}/${repo} (GitHub token=${githubTokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, Forgejo token=${forgejoTokenConfigured ? "yes" : "no"}, Forgejo instances=${forgejoBaseUrls.join(",") || "none"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}, GitLab hosts=${gitlabHosts.join(",")}).`,
  );

  const forgejoCandidatesPromise = mapWithConcurrency(
    forgejoBaseUrls,
    PROVIDER_RESOLUTION_CONCURRENCY,
    (baseUrl) =>
      lookupForgejoCandidate(
        owner,
        repo,
        baseUrl,
        forgejoTokens.get(baseUrl) ?? null,
      ),
  );

  const [
    githubCandidate,
    codebergCandidate,
    forgejoCandidates,
    gitlabCandidates,
  ] = await Promise.all([
    lookupGithubCandidate(owner, repo),
    lookupCodebergCandidate(owner, repo),
    forgejoCandidatesPromise,
    Promise.all(
      gitlabHosts.map((gitlabHost) =>
        lookupGitlabCandidate(owner, repo, gitlabHost),
      ),
    ),
  ]);
  const candidates = [
    githubCandidate,
    codebergCandidate,
    ...forgejoCandidates,
    ...gitlabCandidates,
  ].filter((candidate): candidate is RepoProviderResolutionCandidate =>
    Boolean(candidate),
  );

  log.debug(
    `Repo provider resolution for ${owner}/${repo}: candidates=${candidates.map((c) => c.provider).join(",") || "none"}`,
  );
  return candidates;
}

export async function resolveRepoProvidersAction(input: string): Promise<{
  success: boolean;
  candidates: RepoProviderResolutionCandidate[];
}> {
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, candidates: [] };
  }

  if (!isValidProviderResolutionInput(input)) {
    return { success: false, candidates: [] };
  }

  return { success: true, candidates: await resolveRepoProviders(input) };
}

export async function resolveRepoProvidersBatchAction(
  inputs: string[],
): Promise<{
  success: boolean;
  resolutions: RepoProviderResolution[];
}> {
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, resolutions: [] };
  }

  if (!Array.isArray(inputs) || !inputs.every(isValidProviderResolutionInput)) {
    return { success: false, resolutions: [] };
  }

  const uniqueInputs = [
    ...new Set(
      inputs.map((input) => input.trim()).filter((input) => input.length > 0),
    ),
  ];
  if (uniqueInputs.length > MAX_PROVIDER_RESOLUTION_BATCH_SIZE) {
    log.warn(
      `Rejected provider resolution batch with ${uniqueInputs.length} unique inputs; maximum is ${MAX_PROVIDER_RESOLUTION_BATCH_SIZE}.`,
    );
    return { success: false, resolutions: [] };
  }
  const resolutions = await mapWithConcurrency(
    uniqueInputs,
    PROVIDER_RESOLUTION_CONCURRENCY,
    async (input): Promise<RepoProviderResolution> => ({
      input,
      candidates: await resolveRepoProviders(input),
    }),
  );

  return { success: true, resolutions };
}

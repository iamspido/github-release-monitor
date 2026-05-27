import {
  buildCodebergAuthChain,
  buildGitlabAuthChain,
} from "@/lib/releases/auth-chains";
import {
  fetchResponseWithRetryAuthChain,
  fetchWithRetry,
} from "@/lib/releases/fetch";
import {
  getAllowedGitlabHosts,
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

"use client";

export function formatRepoIdForDisplay(
  repoId: string,
  options?: { showProviderPrefix?: boolean; showProviderDomain?: boolean },
): string {
  const prefixedMatch = repoId.match(/^([^:]+):(.+)$/);
  if (!prefixedMatch) return repoId;

  const [, provider, fullPath] = prefixedMatch;
  let displayPath = fullPath;

  // GitLab repo IDs are stored as `gitlab:<host>/<group>/<repo>`.
  // Optionally remove the host segment for a shorter label.
  if (
    provider.toLowerCase() === "gitlab" &&
    options?.showProviderDomain === false
  ) {
    const segments = fullPath.split("/");
    const host = segments[0];
    const hasEnoughSegments = segments.length >= 3;
    const looksLikeHost =
      host === "localhost" || host.includes(".") || host.includes(":");

    if (hasEnoughSegments && looksLikeHost) {
      displayPath = segments.slice(1).join("/");
    }
  }

  if (options?.showProviderPrefix === false) {
    return displayPath;
  }

  return `${provider}:${displayPath}`;
}

export function getRepositoryNameFromId(repoId: string): string {
  const path = repoId.replace(/^[^:]+:/u, "");
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? repoId;
}

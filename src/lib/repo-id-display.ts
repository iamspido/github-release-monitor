"use client";

export function formatRepoIdForDisplay(
  repoId: string,
  options?: { showProviderPrefix?: boolean; showProviderDomain?: boolean },
): string {
  const prefixedMatch = repoId.match(/^([^:]+):(.+)$/);
  if (!prefixedMatch) return repoId;

  const [, provider, fullPath] = prefixedMatch;
  let displayPath = fullPath;

  // Self-hosted provider IDs contain their instance location. Forgejo has no
  // nested owner groups, so its final two segments are always owner/repo.
  if (
    (provider.toLowerCase() === "gitlab" ||
      provider.toLowerCase() === "forgejo") &&
    options?.showProviderDomain === false
  ) {
    const segments = fullPath.split("/");
    if (provider.toLowerCase() === "forgejo" && segments.length >= 3) {
      displayPath = segments.slice(-2).join("/");
    } else if (provider.toLowerCase() === "gitlab") {
      const host = segments[0];
      const hasEnoughSegments = segments.length >= 3;
      const looksLikeHost =
        host === "localhost" || host.includes(".") || host.includes(":");
      if (hasEnoughSegments && looksLikeHost) {
        displayPath = segments.slice(1).join("/");
      }
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

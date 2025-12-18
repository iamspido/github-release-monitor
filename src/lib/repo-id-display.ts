"use client";

export function formatRepoIdForDisplay(
  repoId: string,
  options?: { showProviderPrefix?: boolean },
): string {
  if (options?.showProviderPrefix !== false) return repoId;

  const match = repoId.match(/^[^:]+:(.+)$/);
  return match?.[1] ?? repoId;
}

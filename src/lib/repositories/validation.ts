// Security: Validates the repoId format.
export function isValidRepoId(repoId: string): boolean {
  if (typeof repoId !== "string") return false;
  // Allows letters, numbers, hyphens, dots, and underscores in the name.
  // Enforces the "owner/repo" structure.
  // Allows an optional provider prefix like `codeberg:`.
  const repoIdRegex = /^(?:[a-z0-9-._]+:)?[a-z0-9-._]+(?:\/[a-z0-9-._]+)+$/i;
  return repoIdRegex.test(repoId);
}

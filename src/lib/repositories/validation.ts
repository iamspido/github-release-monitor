// Security: Validates the repoId format.
export function isValidRepoId(repoId: string): boolean {
  if (typeof repoId !== "string") return false;

  if (repoId.startsWith("forgejo:")) {
    const parts = repoId.slice("forgejo:".length).split("/");
    if (parts.length < 3) return false;
    const authority = parts[0];
    const owner = parts.at(-2);
    const repo = parts.at(-1);
    const basePathParts = parts.slice(1, -2);
    const validRepoPart = /^[a-z0-9._-]+$/i;
    const validBasePathPart =
      /^(?:(?:%[0-9a-f]{2})|[a-z0-9._~!$&'()*+,;=:@-])*$/i;
    if (
      !authority ||
      !owner ||
      !repo ||
      !validRepoPart.test(owner) ||
      !validRepoPart.test(repo) ||
      basePathParts.some(
        (part) => !validBasePathPart.test(part) || /%(?:2f|5c)/i.test(part),
      )
    ) {
      return false;
    }

    for (const protocol of ["http", "https"] as const) {
      try {
        const authorityUrl = new URL(`${protocol}://${authority}`);
        if (
          !authorityUrl.username &&
          !authorityUrl.password &&
          authorityUrl.host.toLowerCase() === authority.toLowerCase() &&
          authorityUrl.pathname === "/"
        ) {
          return true;
        }
      } catch {
        // Try the other supported Forgejo protocol.
      }
    }

    return false;
  }

  return /^(?:[a-z0-9-._]+:)?[a-z0-9-._]+(?:\/[a-z0-9-._]+)+$/i.test(repoId);
}

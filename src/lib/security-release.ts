import type { CachedRelease, GithubRelease } from "@/types";

type SecurityReleaseInput =
  | Pick<GithubRelease | CachedRelease, "body" | "name" | "tag_name">
  | null
  | undefined;

const securityReleasePatterns = [
  /\bsecurity\b/i,
  /\bsecurity\s+(?:advisory|fix|patch|release|update)\b/i,
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bsicherheits(?:fix|patch|release|update)?\b/i,
  /\bsicherheitsl(?:ue|\u00fc)cke(?:n)?\b/i,
];

export function isSecurityRelease(release: SecurityReleaseInput): boolean {
  if (!release) return false;

  const searchableText = [release.name, release.tag_name, release.body]
    .filter(Boolean)
    .join("\n");

  return securityReleasePatterns.some((pattern) =>
    pattern.test(searchableText),
  );
}

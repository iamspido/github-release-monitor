import type {
  CachedRelease,
  GithubRelease,
  SecurityHighlightColorPreset,
} from "@/types";
import { securityHighlightColorPresets } from "@/types";

type SecurityReleaseInput =
  | Pick<GithubRelease | CachedRelease, "body" | "name" | "tag_name">
  | null
  | undefined;

export type SecurityReleaseDetectionOptions = {
  includeDefaultSecurityPatterns?: boolean;
  customSecurityPatterns?: string | null;
};

export const defaultSecurityHighlightColorPreset: SecurityHighlightColorPreset =
  "yellow";
export const defaultSecurityHighlightCustomColor = "#eab308";

const securityReleasePatterns = [
  /\bsecurity\b/i,
  /\bsecurity\s+(?:advisory|fix|patch|release|update)\b/i,
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bsicherheits(?:fix|patch|release|update)?\b/i,
  /\bsicherheitsl(?:ue|\u00fc)cke(?:n)?\b/i,
];

const hexColorPattern = /^#[0-9a-f]{6}$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegexLiteral(value: string) {
  const match = value.match(/^\/(.+)\/([a-z]*)$/i);
  if (!match) return null;
  return { pattern: match[1], flags: match[2] };
}

export function getInvalidCustomSecurityPattern(
  customSecurityPatterns?: string | null,
): string | null {
  const lines = customSecurityPatterns
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines?.length) return null;

  for (const line of lines) {
    const literal = parseRegexLiteral(line);
    if (!literal) continue;
    try {
      new RegExp(literal.pattern, literal.flags);
    } catch {
      return line;
    }
  }

  return null;
}

function getCustomSecurityReleasePatterns(
  customSecurityPatterns?: string | null,
) {
  const lines = customSecurityPatterns
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines?.length) return [];

  return lines.flatMap((line) => {
    const literal = parseRegexLiteral(line);
    try {
      if (literal) {
        return [new RegExp(literal.pattern, literal.flags)];
      }
      return [new RegExp(escapeRegExp(line), "i")];
    } catch {
      return [];
    }
  });
}

export function normalizeSecurityHighlightColorPreset(
  value: unknown,
): SecurityHighlightColorPreset {
  return securityHighlightColorPresets.includes(
    value as SecurityHighlightColorPreset,
  )
    ? (value as SecurityHighlightColorPreset)
    : defaultSecurityHighlightColorPreset;
}

export function normalizeSecurityHighlightCustomColor(value: unknown): string {
  return typeof value === "string" && hexColorPattern.test(value)
    ? value.toLowerCase()
    : defaultSecurityHighlightCustomColor;
}

export function isValidSecurityHighlightCustomColor(value: string): boolean {
  return hexColorPattern.test(value);
}

export function isSecurityRelease(
  release: SecurityReleaseInput,
  options: SecurityReleaseDetectionOptions = {},
): boolean {
  if (!release) return false;

  const searchableText = [release.name, release.tag_name, release.body]
    .filter(Boolean)
    .join("\n");

  const patterns =
    options.includeDefaultSecurityPatterns === false
      ? []
      : [...securityReleasePatterns];
  patterns.push(
    ...getCustomSecurityReleasePatterns(options.customSecurityPatterns),
  );

  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(searchableText);
  });
}

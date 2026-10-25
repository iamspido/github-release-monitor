import {
  compileUntrustedLiteral,
  compileUntrustedPattern,
  MAX_UNTRUSTED_PATTERN_LENGTH,
  type UntrustedPattern,
  UntrustedPatternEvaluationError,
} from "@/lib/untrusted-pattern";
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
const securityMatcherCache = new Map<
  string,
  ReturnType<typeof createSecurityReleaseMatcher>
>();
const maxCachedSecurityMatchers = 100;

const hexColorPattern = /^#[0-9a-f]{6}$/i;

function parseRegexLiteral(value: string) {
  const match = value.match(/^\/(.+)\/([a-z]*)$/i);
  if (!match) return null;
  return { pattern: match[1], flags: match[2] };
}

function customSecurityLines(customSecurityPatterns?: string | null) {
  return (
    customSecurityPatterns
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

function compileCustomSecurityLine(line: string) {
  const literal = parseRegexLiteral(line);
  return literal
    ? compileUntrustedPattern(literal.pattern, literal.flags, {
        discardGroups: true,
      })
    : compileUntrustedLiteral(line);
}

/** The first unusable line that is not already `stored`, or null. */
export function getInvalidCustomSecurityPattern(
  customSecurityPatterns?: string | null,
  stored?: string | null,
): string | null {
  const storedLines = new Set(customSecurityLines(stored));
  for (const line of customSecurityLines(customSecurityPatterns)) {
    if (storedLines.has(line)) continue;
    const unusable = parseRegexLiteral(line)
      ? compileCustomSecurityLine(line).error !== undefined
      : line.length > MAX_UNTRUSTED_PATTERN_LENGTH;
    if (unusable) return line;
  }

  return null;
}

function getCustomSecurityReleasePatterns(
  customSecurityPatterns?: string | null,
): UntrustedPattern[] {
  return customSecurityLines(customSecurityPatterns).flatMap((line) => {
    const { pattern } = compileCustomSecurityLine(line);
    return pattern ? [pattern] : [];
  });
}

export function createSecurityReleaseMatcher(
  options: SecurityReleaseDetectionOptions = {},
): (release: SecurityReleaseInput) => boolean {
  const builtInPatterns =
    options.includeDefaultSecurityPatterns === false
      ? []
      : securityReleasePatterns;
  let customPatterns = getCustomSecurityReleasePatterns(
    options.customSecurityPatterns,
  );

  const matchesCustomPattern = (pattern: UntrustedPattern, text: string) => {
    try {
      return pattern.test(text);
    } catch (error) {
      if (!(error instanceof UntrustedPatternEvaluationError)) throw error;
      customPatterns = customPatterns.filter((other) => other !== pattern);
      return false;
    }
  };

  return (release) => {
    if (!release) return false;

    const searchableText = [release.name, release.tag_name, release.body]
      .filter(Boolean)
      .join("\n");

    return (
      builtInPatterns.some((pattern) => pattern.test(searchableText)) ||
      customPatterns.some((pattern) =>
        matchesCustomPattern(pattern, searchableText),
      )
    );
  };
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

export function getSecurityReleaseMatcher(
  options: SecurityReleaseDetectionOptions = {},
): ReturnType<typeof createSecurityReleaseMatcher> {
  const cacheKey = JSON.stringify([
    options.includeDefaultSecurityPatterns !== false,
    options.customSecurityPatterns ?? "",
  ]);
  let matcher = securityMatcherCache.get(cacheKey);
  if (!matcher) {
    matcher = createSecurityReleaseMatcher(options);
    if (securityMatcherCache.size >= maxCachedSecurityMatchers) {
      const oldestKey = securityMatcherCache.keys().next().value;
      if (oldestKey !== undefined) securityMatcherCache.delete(oldestKey);
    }
    securityMatcherCache.set(cacheKey, matcher);
  }
  return matcher;
}

export function isSecurityRelease(
  release: SecurityReleaseInput,
  options: SecurityReleaseDetectionOptions = {},
): boolean {
  return getSecurityReleaseMatcher(options)(release);
}

import type { Locale } from "@/i18n/config";
import { stripLocalePrefix } from "@/lib/localized-path";

function containsUnsafePathCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || codePoint <= 31 || codePoint === 127;
  });
}

export function normalizeSafeRelativePath(
  value: string | null | undefined,
  fallback = "/",
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (containsUnsafePathCharacter(trimmed)) return fallback;

  try {
    // Inspect the decoded path before URL normalization. Otherwise encoded dot
    // segments can disappear before the safety decision is made.
    const rawPath = trimmed.split(/[?#]/, 1)[0];
    const decodedPath = decodeURIComponent(rawPath);
    if (
      decodedPath.startsWith("//") ||
      containsUnsafePathCharacter(decodedPath) ||
      decodedPath.split("/").includes("..")
    ) {
      return fallback;
    }

    const trustedOrigin = "https://relative-path.invalid";
    const parsed = new URL(trimmed, trustedOrigin);
    if (parsed.origin !== trustedOrigin || !parsed.pathname.startsWith("/")) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function normalizeOptionalSafeRelativePath(
  value: string | null | undefined,
): string | undefined {
  return normalizeSafeRelativePath(value, "") || undefined;
}

export function normalizeLocalizedRedirectPath(
  value: string | null | undefined,
  locale: Locale,
): string {
  return stripLocalePrefix(normalizeSafeRelativePath(value), locale);
}

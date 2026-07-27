import { type Locale, parseLocale } from "@/i18n/config";

function hasPathSegmentPrefix(path: string, prefix: string): boolean {
  const candidate = path.slice(0, prefix.length);
  if (candidate.toLowerCase() !== prefix.toLowerCase()) return false;
  if (path.length === prefix.length) return true;

  const boundary = path[prefix.length];
  return boundary === "/" || boundary === "?" || boundary === "#";
}

export function getSupportedLocalePrefix(path: string): Locale | null {
  if (!path.startsWith("/")) return null;

  const candidate = path.slice(1).split(/[/?#]/, 1)[0];
  return parseLocale(candidate);
}

export function stripLocalePrefix(path: string, locale: Locale): string {
  const prefix = `/${locale}`;
  if (!hasPathSegmentPrefix(path, prefix)) return path;

  const rest = path.slice(prefix.length);
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

export function hasCanonicalLocalePrefix(
  path: string,
  locale: Locale,
): boolean {
  const prefix = `/${locale}`;
  return (
    hasPathSegmentPrefix(path, prefix) &&
    path.slice(0, prefix.length) === prefix
  );
}

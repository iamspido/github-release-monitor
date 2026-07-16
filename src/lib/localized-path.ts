import { locales } from "@/i18n/routing";

export type AppLocale = (typeof locales)[number];

const localeSet = new Set<string>(locales);

function hasPathSegmentPrefix(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  if (!path.startsWith(prefix)) return false;

  const boundary = path[prefix.length];
  return boundary === "/" || boundary === "?" || boundary === "#";
}

export function getSupportedLocalePrefix(path: string): AppLocale | null {
  if (!path.startsWith("/")) return null;

  const candidate = path.slice(1).split(/[/?#]/, 1)[0];
  return localeSet.has(candidate) ? (candidate as AppLocale) : null;
}

export function stripLocalePrefix(path: string, locale: string): string {
  const prefix = `/${locale}`;
  if (!hasPathSegmentPrefix(path, prefix)) return path;

  const rest = path.slice(prefix.length);
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

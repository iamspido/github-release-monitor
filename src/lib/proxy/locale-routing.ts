import type { NextRequest, NextResponse } from "next/server";
import { locales, pathnames } from "@/i18n/routing";
import type { ProxyLocale } from "@/lib/proxy/settings-locale";

const localeSet = new Set<string>(locales as readonly string[]);

export type ProxyRouteKey = keyof typeof pathnames;

const reversePathLookup: Record<
  ProxyLocale,
  Record<string, ProxyRouteKey>
> = locales.reduce(
  (acc, locale) => {
    acc[locale] = {};
    return acc;
  },
  {} as Record<ProxyLocale, Record<string, ProxyRouteKey>>,
);

for (const routeKey of Object.keys(pathnames) as ProxyRouteKey[]) {
  const localized = pathnames[routeKey] as Record<ProxyLocale, string>;
  for (const locale of locales as readonly ProxyLocale[]) {
    const localizedPath = normalizedRestPath(localized[locale]);
    reversePathLookup[locale][localizedPath] = routeKey;
  }
}

export function getCurrentLocaleFromResponse(
  response: NextResponse,
  fallbackLocale: ProxyLocale,
): ProxyLocale {
  const headerLocale = response.headers.get("x-next-intl-locale");
  return (locales as readonly string[]).includes(headerLocale || "")
    ? (headerLocale as ProxyLocale)
    : fallbackLocale;
}

export function getLocalizedLoginPath(locale: ProxyLocale): string {
  const loginPaths = pathnames["/login"];
  return loginPaths[locale as "en" | "de"] || loginPaths.en;
}

export function getRouteKeyForPath(
  locale: ProxyLocale,
  pathname: string,
): ProxyRouteKey | null {
  const { restPath } = splitLocaleFromPath(pathname);
  const normalizedPath = normalizedRestPath(restPath);
  return reversePathLookup[locale][normalizedPath] ?? null;
}

export function splitLocaleFromPath(pathname: string): {
  locale: ProxyLocale | null;
  restPath: string;
} {
  const segments = pathname.split("/");
  const candidate = segments[1];

  if (candidate && localeSet.has(candidate)) {
    const restSegments = segments.slice(2);
    const restPath =
      restSegments.length > 0 ? `/${restSegments.join("/")}` : "/";
    return {
      locale: candidate as ProxyLocale,
      restPath: normalizedRestPath(restPath),
    };
  }

  return { locale: null, restPath: normalizedRestPath(pathname || "/") };
}

export function normalizedRestPath(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.length > 1 && prefixed.endsWith("/")
    ? prefixed.slice(0, -1)
    : prefixed;
}

export function resolveLocalizedRestPath(
  restPath: string,
  targetLocale: ProxyLocale,
  sourceLocale?: ProxyLocale,
): string {
  const normalized = normalizedRestPath(restPath);

  if (sourceLocale) {
    const candidateRoute = reversePathLookup[sourceLocale][normalized];
    if (candidateRoute) {
      return normalizedRestPath(pathnames[candidateRoute][targetLocale]);
    }
  }

  for (const locale of locales as readonly ProxyLocale[]) {
    const candidateRoute = reversePathLookup[locale][normalized];
    if (candidateRoute) {
      return normalizedRestPath(pathnames[candidateRoute][targetLocale]);
    }
  }

  return normalized;
}

export function buildRedirectUrl(
  request: NextRequest,
  locale: ProxyLocale,
  localizedRest: string,
): URL {
  const url = new URL(request.url);
  url.pathname =
    localizedRest === "/" ? `/${locale}` : `/${locale}${localizedRest}`;
  url.search = request.nextUrl.search;
  url.hash = request.nextUrl.hash;
  return url;
}

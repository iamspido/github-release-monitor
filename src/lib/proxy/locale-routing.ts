import type { NextRequest, NextResponse } from "next/server";
import { type Locale, parseLocale } from "@/i18n/config";
import {
  getCanonicalRoutePath,
  getRouteAliases,
  locales,
  pathnames,
} from "@/i18n/routing";
import {
  getSupportedLocalePrefix,
  stripLocalePrefix,
} from "@/lib/localized-path";

export type ProxyRouteKey = keyof typeof pathnames;
export type ProxyRouteMatch = {
  routeKey: ProxyRouteKey;
  isAlias: boolean;
};
export type ProxyRoutePathRegistration = ProxyRouteMatch & {
  locale: Locale;
  path: string;
};

const routePathRegistrations: ProxyRoutePathRegistration[] = [];
for (const routeKey of Object.keys(pathnames) as ProxyRouteKey[]) {
  for (const locale of locales) {
    const localizedPath = getCanonicalRoutePath(routeKey, locale);
    routePathRegistrations.push({
      locale,
      path: localizedPath,
      routeKey,
      isAlias: false,
    });
    for (const alias of getRouteAliases(routeKey, locale)) {
      routePathRegistrations.push({
        locale,
        path: alias,
        routeKey,
        isAlias: true,
      });
    }
  }
}

export function buildRoutePathLookup(
  registrations: readonly ProxyRoutePathRegistration[],
): Record<Locale, Record<string, ProxyRouteMatch>> {
  const lookup = locales.reduce(
    (acc, locale) => {
      acc[locale] = {};
      return acc;
    },
    {} as Record<Locale, Record<string, ProxyRouteMatch>>,
  );

  for (const { locale, path, ...match } of registrations) {
    const normalizedPath = normalizeRoutePathForLookup(path);
    if (!normalizedPath) {
      throw new Error(
        `Invalid localized route path for locale '${locale}': '${path}'.`,
      );
    }
    const existing = lookup[locale][normalizedPath];
    if (existing && existing.routeKey !== match.routeKey) {
      throw new Error(
        `Localized route collision for locale '${locale}' and path '${normalizedPath}'.`,
      );
    }
    if (!existing || (existing.isAlias && !match.isAlias)) {
      lookup[locale][normalizedPath] = match;
    }
  }
  return lookup;
}

const reversePathLookup = buildRoutePathLookup(routePathRegistrations);

export function getCurrentLocaleFromResponse(
  response: NextResponse,
  fallbackLocale: Locale,
): Locale {
  const headerLocale = response.headers.get("x-next-intl-locale");
  return parseLocale(headerLocale) ?? fallbackLocale;
}

export function getLocalizedLoginPath(locale: Locale): string {
  return getCanonicalRoutePath("/login", locale);
}

export function getRouteMatchForPath(
  locale: Locale,
  pathname: string,
): ProxyRouteMatch | null {
  const { restPath } = splitLocaleFromPath(pathname);
  const normalizedPath = normalizeRoutePathForLookup(restPath);
  if (!normalizedPath) return null;
  return reversePathLookup[locale][normalizedPath] ?? null;
}

export function getRouteKeyForPath(
  locale: Locale,
  pathname: string,
): ProxyRouteKey | null {
  return getRouteMatchForPath(locale, pathname)?.routeKey ?? null;
}

export function splitLocaleFromPath(pathname: string): {
  locale: Locale | null;
  restPath: string;
} {
  const locale = getSupportedLocalePrefix(pathname);

  if (locale) {
    return {
      locale,
      restPath: normalizedRestPath(stripLocalePrefix(pathname, locale)),
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

export function normalizeRoutePathForLookup(path: string): string | null {
  const normalizedPath = normalizedRestPath(path);
  if (normalizedPath === "/") return "/";

  try {
    const normalizedSegments = normalizedPath
      .slice(1)
      .split("/")
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("\0")
        ) {
          throw new Error("Encoded path separator");
        }
        return decoded.normalize("NFC");
      });
    return `/${normalizedSegments.join("/")}`;
  } catch {
    return null;
  }
}

export function resolveLocalizedRestPath(
  restPath: string,
  targetLocale: Locale,
  sourceLocale?: Locale,
): string {
  const normalized = normalizedRestPath(restPath);
  const lookupPath = normalizeRoutePathForLookup(normalized);
  if (!lookupPath) return normalized;

  if (sourceLocale) {
    const candidate = reversePathLookup[sourceLocale][lookupPath];
    if (candidate) {
      return normalizedRestPath(
        getCanonicalRoutePath(candidate.routeKey, targetLocale),
      );
    }
  }

  const targetCandidate = reversePathLookup[targetLocale][lookupPath];
  if (targetCandidate) {
    return normalizedRestPath(
      getCanonicalRoutePath(targetCandidate.routeKey, targetLocale),
    );
  }

  return normalized;
}

export function buildRedirectUrl(
  request: NextRequest,
  locale: Locale,
  localizedRest: string,
): URL {
  const url = new URL(request.url);
  url.pathname =
    localizedRest === "/" ? `/${locale}` : `/${locale}${localizedRest}`;
  url.search = request.nextUrl.search;
  url.hash = request.nextUrl.hash;
  return url;
}

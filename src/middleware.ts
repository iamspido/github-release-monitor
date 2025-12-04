import { getIronSession } from "iron-session";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { logger } from "@/lib/logger";
import {
  NEXT_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  SETTINGS_LOCALE_COOKIE,
  settingsLocaleCookieOptions,
} from "@/lib/settings-locale-cookie";
import { defaultLocale, locales, pathnames, routing } from "./i18n/routing";
import { sessionOptions } from "./lib/session";
import type { SessionData } from "./types";

const localeSet = new Set<string>(locales as readonly string[]);
type IronSessionCookieStore = Extract<
  Parameters<typeof getIronSession>[0],
  { get: (...args: unknown[]) => unknown }
>;

function isIronSessionCookieStore(
  value: unknown,
): value is IronSessionCookieStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

type LocaleKey = (typeof locales)[number];
type RouteKey = keyof typeof pathnames;

const reversePathLookup: Record<
  LocaleKey,
  Record<string, RouteKey>
> = locales.reduce(
  (acc, locale) => {
    acc[locale] = {};
    return acc;
  },
  {} as Record<LocaleKey, Record<string, RouteKey>>,
);

for (const routeKey of Object.keys(pathnames) as RouteKey[]) {
  const localized = pathnames[routeKey] as Record<LocaleKey, string>;
  for (const locale of locales as readonly LocaleKey[]) {
    const localizedPath = normalizedRestPath(localized[locale]);
    reversePathLookup[locale][localizedPath] = routeKey;
  }
}

const logSettings = logger.withScope("Settings");
const SETTINGS_LOCALE_API_PATH = "/api/settings-locale";

export async function middleware(request: NextRequest) {
  const logAuth = logger.withScope("Auth");
  const logSecurity = logger.withScope("Security");

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/trpc/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const cookieLocale = getLocaleFromCookies(request);
  const settingsLocale = cookieLocale ?? (await fetchSettingsLocale(request));
  const { locale: requestedLocale, restPath } = splitLocaleFromPath(pathname);

  if (!requestedLocale) {
    const targetRest = resolveLocalizedRestPath(restPath, settingsLocale);
    const redirectUrl = buildRedirectUrl(request, settingsLocale, targetRest);
    if (redirectUrl.pathname !== pathname) {
      const redirectResponse = NextResponse.redirect(redirectUrl);
      attachLocaleCookies(redirectResponse, settingsLocale);
      return redirectResponse;
    }
  } else if (requestedLocale !== settingsLocale) {
    const targetRest = resolveLocalizedRestPath(
      restPath,
      settingsLocale,
      requestedLocale,
    );
    const redirectUrl = buildRedirectUrl(request, settingsLocale, targetRest);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    attachLocaleCookies(redirectResponse, settingsLocale);
    return redirectResponse;
  }

  const handleI18nRouting = createIntlMiddleware(routing);
  const response = handleI18nRouting(request);

  const headerLocale = response.headers.get("x-next-intl-locale");
  const currentLocale = (locales as readonly string[]).includes(
    headerLocale || "",
  )
    ? (headerLocale as LocaleKey)
    : settingsLocale;

  const loginPaths = pathnames["/login"];
  const loginPathForLocale =
    loginPaths[currentLocale as "en" | "de"] || loginPaths.en;
  const isLoginPage = request.nextUrl.pathname.endsWith(loginPathForLocale);

  const cookieStore = request.cookies;
  if (!isIronSessionCookieStore(cookieStore)) {
    throw new TypeError(
      "NextRequest.cookies is missing an expected get method",
    );
  }
  const session = await getIronSession<SessionData>(
    cookieStore,
    sessionOptions,
  );

  if (!session.isLoggedIn && !isLoginPage) {
    const redirectUrl = new URL(
      `/${currentLocale}${loginPathForLocale}`,
      request.url,
    );
    const originalPathname = request.nextUrl.pathname;
    redirectUrl.searchParams.set("next", originalPathname);
    logAuth.warn(
      `Unauthenticated request to '${originalPathname}', redirecting to login.`,
    );
    const redirectResponse = NextResponse.redirect(redirectUrl);
    attachLocaleCookies(redirectResponse, currentLocale);
    return redirectResponse;
  }

  if (session.isLoggedIn && isLoginPage) {
    logAuth.info("Logged-in user on login page, redirecting to home.");
    const redirectResponse = NextResponse.redirect(
      new URL(`/${currentLocale}`, request.url),
    );
    attachLocaleCookies(redirectResponse, currentLocale);
    return redirectResponse;
  }

  if (process.env.NODE_ENV === "development") {
    const allowedDevOrigins = getAllowedDevOrigins();
    const origin = request.headers.get("origin");
    if (
      origin &&
      allowedDevOrigins.length > 0 &&
      !allowedDevOrigins.includes(origin)
    ) {
      logSecurity.warn(`Blocked development origin: ${origin}`);
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  attachLocaleCookies(response, currentLocale);

  const securityHeaders = getSecurityHeaders();
  securityHeaders.forEach((header) => {
    response.headers.set(header.key, header.value);
  });
  logSecurity.debug("Applied security headers");

  return response;
}

function getAllowedDevOrigins(): string[] {
  const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
  return allowedOriginsFromEnv
    ? allowedOriginsFromEnv.split(",").map((origin) => origin.trim())
    : [];
}

function getSecurityHeaders() {
  const https = process.env.HTTPS !== "false";

  const cspPolicies = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // Allow images from any HTTPS origin to support arbitrary release note assets.
    "img-src 'self' https:",
    "connect-src 'self' https://api.github.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (https) {
    cspPolicies.push("upgrade-insecure-requests");
  }

  const cspHeader = cspPolicies.join("; ");

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: cspHeader },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
}

export const config = {
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};

async function fetchSettingsLocale(
  request: NextRequest,
  options?: { fetchImpl?: typeof fetch },
): Promise<LocaleKey> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const apiUrls = buildSettingsLocaleApiUrls(request);
  const attemptSummaries: string[] = [];
  let lastError: unknown = null;

  for (const apiUrl of apiUrls) {
    try {
      const response = await fetchImpl(apiUrl, {
        cache: "no-store",
        headers: {
          "cache-control": "no-store",
          "x-from-middleware": "1",
        },
      });

      if (!response.ok) {
        attemptSummaries.push(
          `${apiUrl.toString()} (status=${response.status})`,
        );
        logSettings.warn(
          `Failed to fetch settings locale (status=${response.status}) from ${apiUrl.origin}. Trying next candidate.`,
        );
        continue;
      }

      const data = (await response.json()) as { locale?: string | null };
      if (data.locale && localeSet.has(data.locale)) {
        return data.locale as LocaleKey;
      }

      attemptSummaries.push(
        `${apiUrl.toString()} (invalid locale='${data.locale ?? "undefined"}')`,
      );
      logSettings.warn(
        `Received invalid locale '${data.locale ?? "undefined"}' from ${apiUrl.origin}. Trying next candidate.`,
      );
    } catch (error) {
      lastError = error;
      attemptSummaries.push(`${apiUrl.toString()} (fetch failed)`);
      logSettings.warn(
        `Error fetching settings locale from ${apiUrl.origin}. Trying next candidate.`,
        error,
      );
    }
  }

  if (apiUrls.length > 0) {
    logSettings.error(
      `Error fetching settings locale in middleware. Attempts: ${attemptSummaries.join("; ")}. Falling back to default locale.`,
      lastError || undefined,
    );
  } else {
    logSettings.error(
      "Error fetching settings locale in middleware. No candidate API origins resolved. Falling back to default locale.",
      lastError || undefined,
    );
  }

  return defaultLocale;
}

function getLocaleFromCookies(request: NextRequest): LocaleKey | null {
  const cookieLocale =
    request.cookies.get(SETTINGS_LOCALE_COOKIE)?.value ??
    request.cookies.get(NEXT_LOCALE_COOKIE)?.value;
  if (cookieLocale && localeSet.has(cookieLocale)) {
    return cookieLocale as LocaleKey;
  }
  return null;
}

function attachLocaleCookies(response: NextResponse, locale: LocaleKey) {
  response.cookies.set(
    SETTINGS_LOCALE_COOKIE,
    locale,
    settingsLocaleCookieOptions,
  );
  response.cookies.set(NEXT_LOCALE_COOKIE, locale, nextLocaleCookieOptions);
}

function splitLocaleFromPath(pathname: string): {
  locale: LocaleKey | null;
  restPath: string;
} {
  const segments = pathname.split("/");
  const candidate = segments[1];

  if (candidate && localeSet.has(candidate)) {
    const restSegments = segments.slice(2);
    const restPath =
      restSegments.length > 0 ? `/${restSegments.join("/")}` : "/";
    return {
      locale: candidate as LocaleKey,
      restPath: normalizedRestPath(restPath),
    };
  }

  return { locale: null, restPath: normalizedRestPath(pathname || "/") };
}

function normalizedRestPath(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.length > 1 && prefixed.endsWith("/")
    ? prefixed.slice(0, -1)
    : prefixed;
}

function resolveLocalizedRestPath(
  restPath: string,
  targetLocale: LocaleKey,
  sourceLocale?: LocaleKey,
): string {
  const normalized = normalizedRestPath(restPath);

  if (sourceLocale) {
    const candidateRoute = reversePathLookup[sourceLocale][normalized];
    if (candidateRoute) {
      return normalizedRestPath(pathnames[candidateRoute][targetLocale]);
    }
  }

  for (const locale of locales as readonly LocaleKey[]) {
    const candidateRoute = reversePathLookup[locale][normalized];
    if (candidateRoute) {
      return normalizedRestPath(pathnames[candidateRoute][targetLocale]);
    }
  }

  return normalized;
}

function buildRedirectUrl(
  request: NextRequest,
  locale: LocaleKey,
  localizedRest: string,
): URL {
  const url = new URL(request.url);
  url.pathname =
    localizedRest === "/" ? `/${locale}` : `/${locale}${localizedRest}`;
  url.search = request.nextUrl.search;
  url.hash = request.nextUrl.hash;
  return url;
}

function buildSettingsLocaleApiUrls(request: NextRequest): URL[] {
  const origins: string[] = [];
  const seen = new Set<string>();

  const addOrigin = (candidate?: string | null) => {
    if (!candidate) return;
    const normalized = normalizeOrigin(candidate);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    origins.push(normalized);
  };

  const requestOrigin = request.nextUrl?.origin;
  addOrigin(requestOrigin);

  const forwardedProto = normalizeProtocolValue(
    getFirstHeaderValue(request.headers.get("x-forwarded-proto")),
  );
  const forwardedHost = getFirstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedPort = getFirstHeaderValue(
    request.headers.get("x-forwarded-port"),
  );
  const headerHost = getFirstHeaderValue(request.headers.get("host"));
  const requestProtocol =
    normalizeProtocolValue(request.nextUrl?.protocol) || "http";
  const requestPort = request.nextUrl?.port;

  const hostEntries = [
    { host: forwardedHost, proto: forwardedProto, port: forwardedPort },
    {
      host: headerHost,
      proto: forwardedProto || requestProtocol,
      port: requestPort || forwardedPort,
    },
  ];

  for (const entry of hostEntries) {
    if (!entry.host) continue;
    const proto =
      normalizeProtocolValue(entry.proto) || inferProtocol(entry.host);
    const port = entry.host.includes(":") ? undefined : entry.port;
    const hostWithPort = port ? `${entry.host}:${port}` : entry.host;
    const origin = `${proto}://${hostWithPort}`;
    addOrigin(origin);
    if (!entry.host.includes(":") && !port && requestPort) {
      addOrigin(`${proto}://${entry.host}:${requestPort}`);
    }
  }

  const fallbackPorts = uniqueDefined([
    forwardedPort,
    requestPort,
    process.env.PORT,
    "3000",
  ]);

  for (const port of fallbackPorts) {
    addOrigin(`http://127.0.0.1:${port}`);
    addOrigin(`http://localhost:${port}`);
  }

  if (origins.length === 0) {
    addOrigin("http://127.0.0.1:3000");
  }

  return origins.map((origin) => new URL(SETTINGS_LOCALE_API_PATH, origin));
}

function uniqueDefined(values: Array<string | undefined | null>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function getFirstHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

function inferProtocol(host: string): string {
  if (!host) return "http";
  if (host.includes("localhost") || host.includes("127.")) {
    return "http";
  }
  return process.env.HTTPS === "false" ? "http" : "https";
}

function normalizeProtocolValue(
  value: string | undefined | null,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed.endsWith(":") ? trimmed.slice(0, -1) : trimmed;
}

function normalizeOrigin(candidate: string): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const tryNormalize = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (!url.protocol || !url.hostname) {
        return null;
      }

      const isZeroAddress = url.hostname === "0.0.0.0" || url.hostname === "::";
      const hostname = isZeroAddress
        ? url.hostname === "::"
          ? "::1"
          : "127.0.0.1"
        : url.hostname;

      const protocol = isZeroAddress
        ? "http"
        : (normalizeProtocolValue(url.protocol) ?? "http");

      const needsBrackets = hostname.includes(":");
      const hostWithPort = url.port
        ? needsBrackets
          ? `[${hostname}]:${url.port}`
          : `${hostname}:${url.port}`
        : needsBrackets
          ? `[${hostname}]`
          : hostname;

      return `${protocol}://${hostWithPort}`;
    } catch {
      return null;
    }
  };

  return (
    tryNormalize(trimmed) ||
    tryNormalize(`http://${trimmed}`) ||
    tryNormalize(`https://${trimmed}`)
  );
}

export const __test__ = {
  fetchSettingsLocale,
  buildSettingsLocaleApiUrls,
};

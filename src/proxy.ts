import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { defaultLocale, type Locale } from "@/i18n/config";
import {
  canReadHomeUnauthenticated,
  getAuthenticationMethod,
} from "@/lib/auth/mode";
import { hasCanonicalLocalePrefix } from "@/lib/localized-path";
import { logger } from "@/lib/logger";
import {
  buildRedirectUrl,
  getCurrentLocaleFromResponse,
  getLocalizedLoginPath,
  getRouteKeyForPath,
  getRouteMatchForPath,
  type ProxyRouteKey,
  resolveLocalizedRestPath,
  splitLocaleFromPath,
} from "@/lib/proxy/locale-routing";
import {
  applySecurityHeaders,
  createRequestSecurityContext,
  forwardSecurityContext,
  getBlockedDevOriginResponse,
} from "@/lib/proxy/security-headers";
import {
  attachLocaleCookies,
  buildSettingsLocaleApiUrls,
  fetchSettingsLocale,
  getLocaleFromCookies,
} from "@/lib/proxy/settings-locale";
import { routing } from "./i18n/routing";

type LocaleKey = Locale;
type RouteKey = ProxyRouteKey;

export async function proxy(request: NextRequest) {
  const logAuth = logger.withScope("Auth");
  const logSecurity = logger.withScope("Security");
  const authenticationMethod = getAuthenticationMethod();

  const pathname = request.nextUrl.pathname;
  if (shouldBypassProxy(request)) {
    return NextResponse.next();
  }
  const securityContext = createRequestSecurityContext();
  const secureResponse = (
    response: NextResponse,
    options: { forwardToRenderer?: boolean } = {},
  ) => {
    if (options.forwardToRenderer) {
      forwardSecurityContext(request, response, securityContext);
    }
    applySecurityHeaders(response, securityContext);
    return response;
  };

  const cookieLocale = getLocaleFromCookies(request);
  const persistedLocale = await fetchSettingsLocale(request, {
    timeoutMs: cookieLocale ? 500 : 2000,
  });
  const settingsLocale = persistedLocale ?? cookieLocale ?? defaultLocale;
  const { locale: requestedLocale, restPath } = splitLocaleFromPath(pathname);

  if (!requestedLocale) {
    const resolvedRest = resolveLocalizedRestPath(restPath, settingsLocale);
    const targetRest = getRouteMatchForPath(settingsLocale, resolvedRest)
      ? resolvedRest
      : "/";
    const redirectUrl = buildRedirectUrl(request, settingsLocale, targetRest);
    if (redirectUrl.pathname !== pathname) {
      const redirectResponse = NextResponse.redirect(redirectUrl);
      attachLocaleCookies(redirectResponse, settingsLocale);
      return secureResponse(redirectResponse);
    }
  } else if (requestedLocale !== settingsLocale) {
    const requestedRouteMatch = getRouteMatchForPath(requestedLocale, restPath);
    if (!requestedRouteMatch) {
      const redirectUrl = buildRedirectUrl(request, settingsLocale, "/");
      const redirectResponse = NextResponse.redirect(redirectUrl);
      attachLocaleCookies(redirectResponse, settingsLocale);
      return secureResponse(redirectResponse);
    }
    const targetRest = resolveLocalizedRestPath(
      restPath,
      settingsLocale,
      requestedLocale,
    );
    const redirectUrl = buildRedirectUrl(request, settingsLocale, targetRest);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    attachLocaleCookies(redirectResponse, settingsLocale);
    return secureResponse(redirectResponse);
  } else {
    const routeMatch = getRouteMatchForPath(requestedLocale, restPath);
    if (!routeMatch) {
      const redirectUrl = buildRedirectUrl(request, requestedLocale, "/");
      const redirectResponse = NextResponse.redirect(redirectUrl);
      attachLocaleCookies(redirectResponse, requestedLocale);
      return secureResponse(redirectResponse);
    }
    if (
      routeMatch.isAlias ||
      !hasCanonicalLocalePrefix(pathname, requestedLocale)
    ) {
      const canonicalRest = resolveLocalizedRestPath(
        restPath,
        requestedLocale,
        requestedLocale,
      );
      const redirectUrl = buildRedirectUrl(
        request,
        requestedLocale,
        canonicalRest,
      );
      const redirectResponse = NextResponse.redirect(redirectUrl, 308);
      attachLocaleCookies(redirectResponse, requestedLocale);
      return secureResponse(redirectResponse);
    }
  }

  const handleI18nRouting = createIntlMiddleware(routing);
  const response = handleI18nRouting(request);

  const currentLocale = getCurrentLocaleFromResponse(response, settingsLocale);

  const routeKey = getRouteKeyForPath(currentLocale, request.nextUrl.pathname);
  const isLoginPage = routeKey === "/login";
  const isRegisterPage = routeKey === "/register";
  const isPasswordRecoveryPage =
    routeKey === "/forgot-password" || routeKey === "/reset-password";
  const isAuthenticated = await checkSessionAuthentication({
    authenticationMethod,
    headers: request.headers,
    pathname,
  });

  if (
    authenticationMethod === "External" &&
    (isLoginPage || isRegisterPage || isPasswordRecoveryPage)
  ) {
    logAuth.info("External auth mode active, redirecting auth page to home.");
    return secureResponse(
      buildLocaleRedirectResponse(request, currentLocale, "/"),
    );
  }

  const authGate = evaluateAuthGate({
    authenticationMethod,
    routeKey,
    isLoginPage,
    isRegisterPage,
    isPasswordRecoveryPage,
  });

  if (!isAuthenticated && authGate.requiresAuth) {
    logAuth.warn(
      `Unauthenticated request to '${request.nextUrl.pathname}', redirecting to login.`,
    );
    return secureResponse(buildLoginRedirectResponse(request, currentLocale));
  }

  if (
    authenticationMethod !== "External" &&
    isAuthenticated &&
    (isLoginPage || isRegisterPage)
  ) {
    logAuth.info("Logged-in user on auth page, redirecting to home.");
    return secureResponse(
      buildLocaleRedirectResponse(request, currentLocale, "/"),
    );
  }

  if (isAuthenticated) {
    logAuth.debug(`Authenticated request allowed for path '${pathname}'.`);
  } else if (authenticationMethod === "External") {
    logAuth.debug(`External auth mode allowed request for path '${pathname}'.`);
  } else if (authGate.isPublicAccessAllowed) {
    logAuth.debug(
      `Unauthenticated request allowed for public path '${pathname}'.`,
    );
  }

  const blockedOriginResponse = getBlockedDevOriginResponse(request);
  if (blockedOriginResponse) {
    logSecurity.warn(
      `Blocked development origin: ${request.headers.get("origin")}`,
    );
    return secureResponse(blockedOriginResponse);
  }

  attachLocaleCookies(response, currentLocale);
  secureResponse(response, { forwardToRenderer: true });
  logSecurity.debug("Applied security headers");

  return response;
}

const publicAssetPaths = new Set(["/icon.svg", "/robots.txt"]);
const staticAssetExtension =
  /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|txt|wasm|webmanifest|webm|webp|woff2?|xml|zip)$/i;

function isDocumentRequest(request: NextRequest): boolean {
  const fetchDestination = request.headers.get("sec-fetch-dest");
  if (fetchDestination) {
    return fetchDestination === "document";
  }
  return request.headers.get("accept")?.includes("text/html") === true;
}

function shouldBypassProxy(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/trpc/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    publicAssetPaths.has(pathname)
  ) {
    return true;
  }

  return staticAssetExtension.test(pathname) && !isDocumentRequest(request);
}

async function checkSessionAuthentication(args: {
  authenticationMethod: ReturnType<typeof getAuthenticationMethod>;
  headers: Headers;
  pathname: string;
}): Promise<boolean> {
  if (args.authenticationMethod === "External") {
    return false;
  }

  const logAuth = logger.withScope("Auth");
  try {
    logAuth.debug(`Checking session for path '${args.pathname}'.`);
    const { auth, ensureAuthDatabaseReady } = await import("@/lib/auth");
    await ensureAuthDatabaseReady();
    const session = await auth.api.getSession({
      headers: args.headers,
    });
    const isAuthenticated = Boolean(session?.session && session?.user);
    logAuth.debug(
      `Session check result for path '${args.pathname}': authenticated=${isAuthenticated}.`,
    );
    return isAuthenticated;
  } catch (error) {
    logAuth.error("Failed to validate session in proxy.", error);
    return false;
  }
}

function evaluateAuthGate(args: {
  authenticationMethod: ReturnType<typeof getAuthenticationMethod>;
  routeKey: RouteKey | null;
  isLoginPage: boolean;
  isRegisterPage: boolean;
  isPasswordRecoveryPage: boolean;
}): { requiresAuth: boolean; isPublicAccessAllowed: boolean } {
  const isPublicAuthPage =
    args.isLoginPage || args.isRegisterPage || args.isPasswordRecoveryPage;
  const canReadPublicHome =
    args.routeKey === "/" &&
    canReadHomeUnauthenticated(args.authenticationMethod);

  if (args.authenticationMethod === "Basic") {
    return {
      requiresAuth: !isPublicAuthPage,
      isPublicAccessAllowed: isPublicAuthPage,
    };
  }

  if (args.authenticationMethod === "AllowUnauthenticated") {
    return {
      requiresAuth: !isPublicAuthPage && !canReadPublicHome,
      isPublicAccessAllowed: isPublicAuthPage || canReadPublicHome,
    };
  }

  return {
    requiresAuth: false,
    isPublicAccessAllowed: isPublicAuthPage || canReadPublicHome,
  };
}

function buildLocaleRedirectResponse(
  request: NextRequest,
  locale: LocaleKey,
  restPath: string,
): NextResponse {
  const redirectResponse = NextResponse.redirect(
    new URL(
      restPath === "/" ? `/${locale}` : `/${locale}${restPath}`,
      request.url,
    ),
  );
  attachLocaleCookies(redirectResponse, locale);
  return redirectResponse;
}

function buildLoginRedirectResponse(
  request: NextRequest,
  locale: LocaleKey,
): NextResponse {
  const redirectUrl = new URL(
    `/${locale}${getLocalizedLoginPath(locale)}`,
    request.url,
  );
  redirectUrl.searchParams.set("next", request.nextUrl.pathname);
  const redirectResponse = NextResponse.redirect(redirectUrl);
  attachLocaleCookies(redirectResponse, locale);
  return redirectResponse;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|trpc(?:/|$)|_next(?:/|$)|_vercel(?:/|$)).*)"],
};

export const __test__ = {
  fetchSettingsLocale,
  buildSettingsLocaleApiUrls,
};

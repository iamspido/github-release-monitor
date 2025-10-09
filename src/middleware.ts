import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from './lib/session';
import type { SessionData } from './types';
import { routing, locales, defaultLocale, pathnames } from './i18n/routing';
import { logger } from '@/lib/logger';
import {
  NEXT_LOCALE_COOKIE,
  SETTINGS_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  settingsLocaleCookieOptions,
} from '@/lib/settings-locale-cookie';

const localeSet = new Set<string>(locales as readonly string[]);

type LocaleKey = (typeof locales)[number];
type RouteKey = keyof typeof pathnames;

const reversePathLookup: Record<LocaleKey, Record<string, RouteKey>> = locales.reduce(
  (acc, locale) => {
    acc[locale] = {};
    return acc;
  },
  {} as Record<LocaleKey, Record<string, RouteKey>>
);

for (const routeKey of Object.keys(pathnames) as RouteKey[]) {
  const localized = pathnames[routeKey] as Record<LocaleKey, string>;
  for (const locale of locales as readonly LocaleKey[]) {
    const localizedPath = normalizedRestPath(localized[locale]);
    reversePathLookup[locale][localizedPath] = routeKey;
  }
}

const logSettings = logger.withScope('Settings');

export async function middleware(request: NextRequest) {
  const logAuth = logger.withScope('Auth');
  const logSecurity = logger.withScope('Security');

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/trpc/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/_vercel/') ||
    pathname.includes('.')
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
    const targetRest = resolveLocalizedRestPath(restPath, settingsLocale, requestedLocale);
    const redirectUrl = buildRedirectUrl(request, settingsLocale, targetRest);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    attachLocaleCookies(redirectResponse, settingsLocale);
    return redirectResponse;
  }

  const handleI18nRouting = createIntlMiddleware(routing);
  const response = handleI18nRouting(request);

  const headerLocale = response.headers.get('x-next-intl-locale');
  const currentLocale = (locales as readonly string[]).includes(headerLocale || '')
    ? (headerLocale as LocaleKey)
    : settingsLocale;

  const loginPathForLocale =
    pathnames['/login'][currentLocale as 'en' | 'de'] || pathnames['/login']['en'];
  const isLoginPage = request.nextUrl.pathname.endsWith(loginPathForLocale);

  const session = await getIronSession<SessionData>(request.cookies as any, sessionOptions);

  if (!session.isLoggedIn && !isLoginPage) {
    const redirectUrl = new URL(`/${currentLocale}${loginPathForLocale}`, request.url);
    const originalPathname = request.nextUrl.pathname;
    redirectUrl.searchParams.set('next', originalPathname);
    logAuth.warn(
      `Unauthenticated request to '${originalPathname}', redirecting to login.`,
    );
    const redirectResponse = NextResponse.redirect(redirectUrl);
    attachLocaleCookies(redirectResponse, currentLocale);
    return redirectResponse;
  }

  if (session.isLoggedIn && isLoginPage) {
    logAuth.info('Logged-in user on login page, redirecting to home.');
    const redirectResponse = NextResponse.redirect(new URL(`/${currentLocale}`, request.url));
    attachLocaleCookies(redirectResponse, currentLocale);
    return redirectResponse;
  }

  if (process.env.NODE_ENV === 'development') {
    const allowedDevOrigins = getAllowedDevOrigins();
    const origin = request.headers.get('origin');
    if (origin && allowedDevOrigins.length > 0 && !allowedDevOrigins.includes(origin)) {
      logSecurity.warn(`Blocked development origin: ${origin}`);
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  attachLocaleCookies(response, currentLocale);

  const securityHeaders = getSecurityHeaders();
  securityHeaders.forEach(header => {
    response.headers.set(header.key, header.value);
  });
  logSecurity.debug('Applied security headers');

  return response;
}

function getAllowedDevOrigins(): string[] {
  const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
  return allowedOriginsFromEnv
    ? allowedOriginsFromEnv.split(',').map(origin => origin.trim())
    : [];
}

function getSecurityHeaders() {
  const https = process.env.HTTPS !== 'false';

  const cspPolicies = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://placehold.co",
    "connect-src 'self' https://api.github.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (https) {
    cspPolicies.push('upgrade-insecure-requests');
  }

  const cspHeader = cspPolicies.join('; ');

  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: cspHeader },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
  ];
}

export const config = {
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};

async function fetchSettingsLocale(request: NextRequest): Promise<LocaleKey> {
  try {
    const apiUrl = new URL('/api/settings-locale', request.url);
    const response = await fetch(apiUrl, {
      cache: 'no-store',
      headers: {
        'cache-control': 'no-store',
        'x-from-middleware': '1',
      },
    });

    if (!response.ok) {
      logSettings.warn(
        `Failed to fetch settings locale (status=${response.status}). Falling back to default locale.`,
      );
      return defaultLocale;
    }

    const data = (await response.json()) as { locale?: string | null };
    if (data.locale && localeSet.has(data.locale)) {
      return data.locale as LocaleKey;
    }

    logSettings.warn(
      `Received invalid locale '${data.locale ?? 'undefined'}' from settings. Falling back to default locale.`,
    );
  } catch (error) {
    logSettings.error('Error fetching settings locale in middleware. Falling back to default locale.', error);
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
  response.cookies.set(SETTINGS_LOCALE_COOKIE, locale, settingsLocaleCookieOptions);
  response.cookies.set(NEXT_LOCALE_COOKIE, locale, nextLocaleCookieOptions);
}

function splitLocaleFromPath(pathname: string): { locale: LocaleKey | null; restPath: string } {
  const segments = pathname.split('/');
  const candidate = segments[1];

  if (candidate && localeSet.has(candidate)) {
    const restSegments = segments.slice(2);
    const restPath = restSegments.length > 0 ? `/${restSegments.join('/')}` : '/';
    return { locale: candidate as LocaleKey, restPath: normalizedRestPath(restPath) };
  }

  return { locale: null, restPath: normalizedRestPath(pathname || '/') };
}

function normalizedRestPath(path: string): string {
  if (!path || path === '/') {
    return '/';
  }
  const prefixed = path.startsWith('/') ? path : `/${path}`;
  return prefixed.length > 1 && prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
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

function buildRedirectUrl(request: NextRequest, locale: LocaleKey, localizedRest: string): URL {
  const url = new URL(request.url);
  url.pathname = localizedRest === '/' ? `/${locale}` : `/${locale}${localizedRest}`;
  url.search = request.nextUrl.search;
  url.hash = request.nextUrl.hash;
  return url;
}

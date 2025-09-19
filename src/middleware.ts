import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from './lib/session';
import type { SessionData } from './types';
import { routing, locales, defaultLocale, pathnames } from './i18n/routing';
import { logger } from '@/lib/logger';

export async function middleware(request: NextRequest) {
  const logAuth = logger.withScope('Auth');
  const logSecurity = logger.withScope('Security');

  // Step 1: Create and call the internationalization middleware.
  const handleI18nRouting = createIntlMiddleware(routing);
  const response = handleI18nRouting(request);

  // Step 2: Determine the current locale from the response.
  const headerLocale = response.headers.get('x-next-intl-locale');
  const currentLocale = (locales as readonly string[]).includes(headerLocale || '')
    ? headerLocale!
    : defaultLocale;

  // Step 3: Define the localized login path.
  const loginPathForLocale =
    pathnames['/login'][currentLocale as 'en' | 'de'] || pathnames['/login']['en'];

  // Step 4: Check if the current request is for the login page.
  const isLoginPage = request.nextUrl.pathname.endsWith(loginPathForLocale);

  // Step 5: Check the session.
  const session = await getIronSession<SessionData>(request.cookies as any, sessionOptions);

  // Step 6: Redirect logic based on authentication status.
  if (!session.isLoggedIn && !isLoginPage) {
    const redirectUrl = new URL(`/${currentLocale}${loginPathForLocale}`, request.url);
    const originalPathname = request.nextUrl.pathname;
    redirectUrl.searchParams.set('next', originalPathname);
    logAuth.warn(
      `Unauthenticated request to '${originalPathname}', redirecting to login.`,
    );
    return NextResponse.redirect(redirectUrl);
  } else if (session.isLoggedIn && isLoginPage) {
    logAuth.info('Logged-in user on login page, redirecting to home.');
    return NextResponse.redirect(new URL(`/${currentLocale}`, request.url));
  }

  // Step 7: Handle development origins validation
  if (process.env.NODE_ENV === 'development') {
    const allowedDevOrigins = getAllowedDevOrigins();
    const origin = request.headers.get('origin');
    if (origin && allowedDevOrigins.length > 0 && !allowedDevOrigins.includes(origin)) {
      logSecurity.warn(`Blocked development origin: ${origin}`);
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // Step 8: Add security headers.
  const securityHeaders = getSecurityHeaders();
  securityHeaders.forEach(header => {
    response.headers.set(header.key, header.value);
  });
  logSecurity.debug('Applied security headers');

  // Step 9: Return the response from the i18n middleware.
  return response;
}

// Helper function to get allowed development origins dynamically
function getAllowedDevOrigins(): string[] {
  const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
  return allowedOriginsFromEnv
    ? allowedOriginsFromEnv.split(',').map(origin => origin.trim())
    : [];
}

// Helper function to generate security headers dynamically
function getSecurityHeaders() {
  // Determine if running in HTTPS mode. Defaults to true.
  const https = process.env.HTTPS !== 'false';

  // Dynamically construct the Content Security Policy
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
    "frame-ancestors 'none'"
  ];

  // Only add upgrade-insecure-requests if HTTPS is desired
  if (https) {
    cspPolicies.push("upgrade-insecure-requests");
  }

  // The final semicolon is optional but good practice.
  const cspHeader = cspPolicies.join('; ');

  return [
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'Content-Security-Policy',
      value: cspHeader,
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    {
      key: 'Referrer-Policy',
      value: 'no-referrer',
    }
  ];
}

export const config = {
  // Match all pathnames except for
  // - … if they start with `/api`, `/trpc`, `/_next` or `/_vercel`
  // - … the ones containing a dot (e.g. `favicon.ico`)
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};

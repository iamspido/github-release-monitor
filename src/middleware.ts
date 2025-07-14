
import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from './lib/session';
import type { SessionData } from './types';
import { locales, pathnames } from './i18n';

export async function middleware(request: NextRequest) {
  // Step 1: Determine the user's preferred locale from the cookie.
  // Fallback to 'en' if the cookie is not set.
  const preferredLocale = request.cookies.get('NEXT_LOCALE')?.value || 'en';

  // Step 2: Create a middleware handler for internationalization.
  // It will now use the explicitly determined locale as the default.
  const handleI18nRouting = createIntlMiddleware({
    locales,
    defaultLocale: preferredLocale,
    pathnames,
    localePrefix: 'always',
  });
  // This response will be used if no auth redirect is needed.
  // It handles locale detection and setting the correct headers.
  const response = handleI18nRouting(request);

  // Step 3: Determine the current locale from the response prepared by next-intl.
  const currentLocale = response.headers.get('x-next-intl-locale') || preferredLocale;

  // Step 4: Define the localized login path.
  const loginPathForLocale = pathnames['/login'][currentLocale as 'en' | 'de'] || pathnames['/login']['en'];

  // Step 5: Check if the current request is for the login page to prevent a redirect loop.
  const isLoginPage = request.nextUrl.pathname.endsWith(loginPathForLocale);

  // Step 6: Check the session.
  const session = await getIronSession<SessionData>(request.cookies, sessionOptions);

  // Step 7: Redirect logic
  if (!session.isLoggedIn && !isLoginPage) {
    // User is not logged in and not on the login page.
    // Redirect them to the login page for their current locale.
    const redirectUrl = new URL(`/${currentLocale}${loginPathForLocale}`, request.url);
    
    // Preserve the original path as a 'next' parameter so the user can be sent back after logging in.
    const originalPath = request.nextUrl.pathname;
    
    redirectUrl.searchParams.set('next', originalPath);
    
    return NextResponse.redirect(redirectUrl);
  } else if (session.isLoggedIn && isLoginPage) {
    // User is logged in but trying to access the login page.
    // Redirect them to the home page for their current locale.
    return NextResponse.redirect(new URL(`/${currentLocale}`, request.url));
  }

  // Step 8: If no authentication-related redirect is necessary, return the response from the i18n middleware.
  return response;
}

export const config = {
  // All paths are protected by default, except for static files and API routes.
  // The logic inside the middleware handles which pages require login.
  matcher: ['/((?!api|_next/static|_next/image|.*\\.svg$|favicon.ico|auth/logout).*)'],
};

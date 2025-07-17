
import type { SessionData } from '@/types';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

// This setting controls whether the application operates in secure (HTTPS)
// or insecure (HTTP) mode. It defaults to 'true' (HTTPS) unless explicitly
// set to 'false' in the environment variables.
const https = process.env.HTTPS !== 'false';

export const sessionOptions = {
  password: process.env.AUTH_SECRET as string,
  cookieName: 'github-release-monitor-session',
  cookieOptions: {
    // This will be true unless HTTPS is explicitly set to 'false'.
    secure: https,
    // SameSite=Strict provides the best protection against CSRF attacks.
    sameSite: 'strict' as const,
    // HttpOnly prevents client-side JavaScript from accessing the cookie,
    // which is a critical defense against XSS.
    httpOnly: true,
  },
};

// --- One-time checks and warnings ---
// The `global` object is used here to ensure these checks run only once
// per server start, not on every hot-reload or request. This prevents log spam.

// 1. Check for a secure session key.
// This block runs only once when the server starts.
if (!(global as any)._authSecretChecked) {
    if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
        console.error('CRITICAL: Missing or insecure AUTH_SECRET. Must be at least 32 characters long. Please check your .env file.');
    }
    // Set the flag to true after the first check to prevent re-running.
    (global as any)._authSecretChecked = true;
}

// 2. Warn if running in production over HTTP.
// This block also runs only once at startup.
if (!(global as any)._httpWarningIssued) {
    if (process.env.NODE_ENV === 'production' && !https) {
        console.warn(
            'WARNING: Application is running in PRODUCTION mode with HTTPS=false. This is insecure and not recommended unless running behind a trusted reverse proxy that handles TLS termination.'
        );
    }
    // Set the flag to true after the first check.
    (global as any)._httpWarningIssued = true;
}


export async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return session;
}

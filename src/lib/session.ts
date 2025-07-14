
import type { SessionData } from '@/types';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export const sessionOptions = {
  password: process.env.AUTH_SECRET as string,
  cookieName: 'github-release-monitor-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    // SameSite=Strict provides the best protection against CSRF attacks.
    sameSite: 'strict' as const,
    // HttpOnly prevents client-side JavaScript from accessing the cookie,
    // which is a critical defense against XSS.
    httpOnly: true,
  },
};

if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    console.error('Missing or insecure AUTH_SECRET. Must be at least 32 characters long. Please check your .env file.');
}

export async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return session;
}

const sessionCookieNames = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);

const testRepoBaselineCookieName = "grm-e2e-test-repo-baseline";

export function hasAuthenticationSessionCookie(
  cookies: ReadonlyArray<{ name: string }>,
): boolean {
  return cookies.some((cookie) => sessionCookieNames.has(cookie.name));
}

export function hasTestRepoBaselineCookie(
  cookies: ReadonlyArray<{ name: string }>,
): boolean {
  return cookies.some((cookie) => cookie.name === testRepoBaselineCookieName);
}

export function getTestRepoBaselineCookieName(): string {
  return testRepoBaselineCookieName;
}

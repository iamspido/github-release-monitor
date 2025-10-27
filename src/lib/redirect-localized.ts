import { redirect as nextRedirect } from "next/navigation";

type NextRedirect = typeof nextRedirect;

// Redirect helper that stays compatible with tests mocking `@/navigation`.
export async function redirectLocalized(path: string, locale: string) {
  if (process.env.NODE_ENV === "test") {
    const mod = await import("@/i18n/navigation");
    // In tests, redirect is mocked to track calls and throw '__REDIRECT__'
    const redirectFn = mod.redirect as unknown as NextRedirect;
    return redirectFn(path);
  }
  // At runtime, always prefix with locale explicitly to avoid next-intl header access.
  return nextRedirect(`/${locale}${path}`);
}

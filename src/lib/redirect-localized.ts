import { redirect as nextRedirect } from "next/navigation";
import { redirect as testRedirect } from "@/i18n/navigation";

type NextRedirect = typeof nextRedirect;

// Keep this synchronous so Next.js handles NEXT_REDIRECT as a Server Action redirect.
export function redirectLocalized(path: string, locale: string): never {
  if (process.env.NODE_ENV === "test") {
    // In tests, redirect is mocked to track calls and throw '__REDIRECT__'
    const redirectFn = testRedirect as unknown as NextRedirect;
    return redirectFn(path);
  }
  // At runtime, always prefix with locale explicitly to avoid next-intl header access.
  return nextRedirect(`/${locale}${path}`);
}

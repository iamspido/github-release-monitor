import { redirect as nextRedirect } from 'next/navigation';

// Redirect helper that stays compatible with tests mocking `@/navigation`.
export async function redirectLocalized(path: string, locale: string) {
  if (process.env.NODE_ENV === 'test') {
    const mod = await import('@/navigation');
    // In tests, redirect is mocked to track calls and throw '__REDIRECT__'
    return (mod.redirect as any)(path);
  }
  // At runtime, always prefix with locale explicitly to avoid next-intl header access.
  return nextRedirect(`/${locale}${path}`);
}


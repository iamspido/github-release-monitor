import { headers } from 'next/headers';
import { defaultLocale, locales } from '@/i18n-config';

// Read locale from request headers in a Next 15-safe way
export async function getRequestLocale(): Promise<string> {
  try {
    const hdrs = await headers();
    const headerLocale = hdrs.get('X-NEXT-INTL-LOCALE') || hdrs.get('x-next-intl-locale');
    const locale = (headerLocale || '').toLowerCase();
    if (locales.includes(locale as any)) return locale;
  } catch {
    // ignore and fall back
  }
  return defaultLocale;
}

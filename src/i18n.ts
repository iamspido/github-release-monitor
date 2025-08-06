import {getRequestConfig} from 'next-intl/server';
import { notFound } from 'next/navigation';
import type {Pathnames} from 'next-intl/navigation';

export const locales = ['en', 'de'];
export const defaultLocale = 'en';

// Centralized pathnames for the app
export const pathnames = {
  '/settings': {
    en: '/settings',
    de: '/einstellungen',
  },
  '/login': {
    en: '/login',
    de: '/anmelden',
  },
  '/test': {
    en: '/test',
    de: '/test',
  },
} satisfies Pathnames<typeof locales>;


export default getRequestConfig(async ({requestLocale}) => {
  // This typically corresponds to the `[locale]` segment
  const locale = await requestLocale;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as any)) notFound();

  return {
    messages: (await import(`./messages/${locale}.json`)).default,
    locale,
  };
});

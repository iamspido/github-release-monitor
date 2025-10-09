import { Pathnames, defineRouting } from 'next-intl/routing';

export const locales = ['en', 'de'] as const;
export const defaultLocale = 'en' as const;

// Centralized pathnames for the app (no side-effects)
export const pathnames = {
  '/': {
    en: '/',
    de: '/',
  },
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

export const routing = defineRouting({
  locales,
  defaultLocale,
  pathnames,
});

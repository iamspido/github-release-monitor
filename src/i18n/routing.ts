import { defineRouting, type Pathnames } from "next-intl/routing";
import {
  defaultLocale,
  englishLocale,
  type Locale,
  locales,
} from "@/i18n/config";

export const pathnames = {
  "/": {
    en: "/",
    de: "/",
    fr: "/",
    ar: "/",
  },
  "/settings": {
    en: "/settings",
    de: "/einstellungen",
    fr: "/parametres",
    ar: "/الإعدادات",
  },
  "/login": {
    en: "/login",
    de: "/anmelden",
    fr: "/connexion",
    ar: "/تسجيل-الدخول",
  },
  "/register": {
    en: "/register",
    de: "/registrieren",
    fr: "/inscription",
    ar: "/إنشاء-حساب",
  },
  "/test": {
    en: "/test",
    de: "/test",
    fr: "/test",
    ar: "/اختبار",
  },
} satisfies Pathnames<typeof locales>;

export type AppRoute = keyof typeof pathnames;

const historicalAliases: Partial<
  Record<Locale, Partial<Record<AppRoute, readonly string[]>>>
> = {};

export function getCanonicalRoutePath(route: AppRoute, locale: Locale): string {
  return pathnames[route][locale];
}

export function getRouteAliases(
  route: AppRoute,
  locale: Locale,
): readonly string[] {
  const canonicalPath = getCanonicalRoutePath(route, locale);
  const englishPath = getCanonicalRoutePath(route, englishLocale);
  const configuredAliases =
    (
      historicalAliases[locale] as
        | Partial<Record<AppRoute, readonly string[]>>
        | undefined
    )?.[route] ?? [];

  return Array.from(
    new Set(
      [englishPath, ...configuredAliases].filter(
        (candidate) => candidate !== canonicalPath,
      ),
    ),
  );
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  pathnames,
});

export { defaultLocale, locales };

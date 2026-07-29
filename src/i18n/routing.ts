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
    es: "/",
    "pt-BR": "/",
    id: "/",
    hi: "/",
    "zh-CN": "/",
    ja: "/",
    ko: "/",
    tr: "/",
    ar: "/",
  },
  "/settings": {
    en: "/settings",
    de: "/einstellungen",
    fr: "/parametres",
    es: "/configuracion",
    "pt-BR": "/configuracoes",
    id: "/pengaturan",
    hi: "/सेटिंग्स",
    "zh-CN": "/设置",
    ja: "/設定",
    ko: "/설정",
    tr: "/ayarlar",
    ar: "/الإعدادات",
  },
  "/login": {
    en: "/login",
    de: "/anmelden",
    fr: "/connexion",
    es: "/iniciar-sesion",
    "pt-BR": "/entrar",
    id: "/masuk",
    hi: "/लॉगिन",
    "zh-CN": "/登录",
    ja: "/ログイン",
    ko: "/로그인",
    tr: "/giriş",
    ar: "/تسجيل-الدخول",
  },
  "/register": {
    en: "/register",
    de: "/registrieren",
    fr: "/inscription",
    es: "/registro",
    "pt-BR": "/cadastro",
    id: "/daftar",
    hi: "/पंजीकरण",
    "zh-CN": "/注册",
    ja: "/登録",
    ko: "/회원가입",
    tr: "/kayıt",
    ar: "/إنشاء-حساب",
  },
  "/test": {
    en: "/test",
    de: "/test",
    fr: "/test",
    es: "/prueba",
    "pt-BR": "/teste",
    id: "/uji",
    hi: "/परीक्षण",
    "zh-CN": "/测试",
    ja: "/テスト",
    ko: "/테스트",
    tr: "/test",
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

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
    vi: "/",
    it: "/",
    pl: "/",
    uk: "/",
    nl: "/",
    ru: "/",
    he: "/",
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
    vi: "/cai-dat",
    it: "/impostazioni",
    pl: "/ustawienia",
    uk: "/налаштування",
    nl: "/instellingen",
    ru: "/настройки",
    he: "/הגדרות",
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
    vi: "/dang-nhap",
    it: "/accesso",
    pl: "/logowanie",
    uk: "/вхід",
    nl: "/inloggen",
    ru: "/вход",
    he: "/התחברות",
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
    vi: "/dang-ky",
    it: "/registrazione",
    pl: "/rejestracja",
    uk: "/реєстрація",
    nl: "/registreren",
    ru: "/регистрация",
    he: "/הרשמה",
    ar: "/إنشاء-حساب",
  },
  "/forgot-password": {
    en: "/forgot-password",
    de: "/passwort-vergessen",
    fr: "/mot-de-passe-oublie",
    es: "/olvide-contrasena",
    "pt-BR": "/esqueci-senha",
    id: "/lupa-kata-sandi",
    hi: "/पासवर्ड-भूल-गए",
    "zh-CN": "/忘记密码",
    ja: "/パスワードを忘れた",
    ko: "/비밀번호-찾기",
    tr: "/sifremi-unuttum",
    vi: "/quen-mat-khau",
    it: "/password-dimenticata",
    pl: "/nie-pamietam-hasla",
    uk: "/забули-пароль",
    nl: "/wachtwoord-vergeten",
    ru: "/забыли-пароль",
    he: "/שכחתי-סיסמה",
    ar: "/نسيت-كلمة-المرور",
  },
  "/reset-password": {
    en: "/reset-password",
    de: "/passwort-zuruecksetzen",
    fr: "/reinitialiser-mot-de-passe",
    es: "/restablecer-contrasena",
    "pt-BR": "/redefinir-senha",
    id: "/atur-ulang-kata-sandi",
    hi: "/पासवर्ड-रीसेट",
    "zh-CN": "/重置密码",
    ja: "/パスワード再設定",
    ko: "/비밀번호-재설정",
    tr: "/sifre-sifirla",
    vi: "/dat-lai-mat-khau",
    it: "/reimposta-password",
    pl: "/zresetuj-haslo",
    uk: "/скинути-пароль",
    nl: "/wachtwoord-opnieuw-instellen",
    ru: "/сбросить-пароль",
    he: "/איפוס-סיסמה",
    ar: "/إعادة-تعيين-كلمة-المرور",
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
    vi: "/kiem-tra",
    it: "/test",
    pl: "/test",
    uk: "/тест",
    nl: "/test",
    ru: "/тест",
    he: "/בדיקה",
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

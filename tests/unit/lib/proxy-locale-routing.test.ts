import type { NextRequest, NextResponse } from "next/server";
import { getRouteAliases } from "@/i18n/routing";
import { hasCanonicalLocalePrefix } from "@/lib/localized-path";
import {
  buildRedirectUrl,
  buildRoutePathLookup,
  getCurrentLocaleFromResponse,
  getLocalizedLoginPath,
  getRouteKeyForPath,
  getRouteMatchForPath,
  normalizedRestPath,
  normalizeRoutePathForLookup,
  resolveLocalizedRestPath,
  splitLocaleFromPath,
} from "@/lib/proxy/locale-routing";

describe("proxy/locale-routing", () => {
  it.each([
    ["", "/"],
    ["/", "/"],
    ["settings", "/settings"],
    ["/settings", "/settings"],
    ["/settings/", "/settings"],
  ])("normalizes rest path %j to %j", (input, expected) => {
    expect(normalizedRestPath(input)).toBe(expected);
  });

  it.each([
    ["/de/einstellungen/", { locale: "de", restPath: "/einstellungen" }],
    ["/DE/settings", { locale: "de", restPath: "/settings" }],
    ["/en/login", { locale: "en", restPath: "/login" }],
    ["/ar/الإعدادات", { locale: "ar", restPath: "/الإعدادات" }],
    ["/fr/parametres", { locale: "fr", restPath: "/parametres" }],
    ["/es/configuracion", { locale: "es", restPath: "/configuracion" }],
    ["/pt-br/configuracoes", { locale: "pt-BR", restPath: "/configuracoes" }],
    ["/ID/pengaturan", { locale: "id", restPath: "/pengaturan" }],
    ["/HI/सेटिंग्स", { locale: "hi", restPath: "/सेटिंग्स" }],
    ["/zh-cn/设置", { locale: "zh-CN", restPath: "/设置" }],
    ["/JA/設定", { locale: "ja", restPath: "/設定" }],
    ["/KO/설정", { locale: "ko", restPath: "/설정" }],
    ["/TR/ayarlar", { locale: "tr", restPath: "/ayarlar" }],
    ["/VI/cai-dat", { locale: "vi", restPath: "/cai-dat" }],
    ["/IT/impostazioni", { locale: "it", restPath: "/impostazioni" }],
    ["/PL/ustawienia", { locale: "pl", restPath: "/ustawienia" }],
    ["/UK/налаштування", { locale: "uk", restPath: "/налаштування" }],
    ["/NL/instellingen", { locale: "nl", restPath: "/instellingen" }],
    ["/RU/настройки", { locale: "ru", restPath: "/настройки" }],
    ["/HE/הגדרות", { locale: "he", restPath: "/הגדרות" }],
    ["/settings", { locale: null, restPath: "/settings" }],
    ["", { locale: null, restPath: "/" }],
  ] as const)("splits locale path %j", (pathname, expected) => {
    expect(splitLocaleFromPath(pathname)).toEqual(expected);
  });

  it("distinguishes canonical locale casing after case-insensitive parsing", () => {
    expect(hasCanonicalLocalePrefix("/de/einstellungen", "de")).toBe(true);
    expect(hasCanonicalLocalePrefix("/DE/einstellungen", "de")).toBe(false);
  });

  it("uses English paths as aliases independently of the default locale", () => {
    expect(getRouteAliases("/settings", "de")).toContain("/settings");
    expect(getRouteAliases("/settings", "en")).not.toContain("/settings");
    expect(getRouteAliases("/settings", "fr")).toContain("/settings");
    expect(getRouteAliases("/settings", "es")).toContain("/settings");
    expect(getRouteAliases("/settings", "pt-BR")).toContain("/settings");
    expect(getRouteAliases("/settings", "id")).toContain("/settings");
    expect(getRouteAliases("/settings", "hi")).toContain("/settings");
    expect(getRouteAliases("/settings", "zh-CN")).toContain("/settings");
    expect(getRouteAliases("/settings", "ja")).toContain("/settings");
    expect(getRouteAliases("/settings", "ko")).toContain("/settings");
    expect(getRouteAliases("/settings", "tr")).toContain("/settings");
    expect(getRouteAliases("/settings", "vi")).toContain("/settings");
    expect(getRouteAliases("/settings", "it")).toContain("/settings");
    expect(getRouteAliases("/settings", "pl")).toContain("/settings");
    expect(getRouteAliases("/settings", "uk")).toContain("/settings");
    expect(getRouteAliases("/settings", "nl")).toContain("/settings");
    expect(getRouteAliases("/settings", "ru")).toContain("/settings");
    expect(getRouteAliases("/settings", "he")).toContain("/settings");
    expect(getRouteAliases("/settings", "ar")).toContain("/settings");
    expect(getRouteAliases("/test", "tr")).not.toContain("/test");
  });

  it("resolves route keys and localized paths in both directions", () => {
    expect(getRouteKeyForPath("de", "/de/einstellungen")).toBe("/settings");
    expect(getRouteKeyForPath("en", "/en/login")).toBe("/login");
    expect(getRouteKeyForPath("fr", "/fr/parametres")).toBe("/settings");
    expect(getRouteKeyForPath("fr", "/fr/connexion")).toBe("/login");
    expect(getRouteKeyForPath("fr", "/fr/inscription")).toBe("/register");
    expect(getRouteKeyForPath("es", "/es/configuracion")).toBe("/settings");
    expect(getRouteKeyForPath("es", "/es/iniciar-sesion")).toBe("/login");
    expect(getRouteKeyForPath("es", "/es/registro")).toBe("/register");
    expect(getRouteKeyForPath("es", "/es/prueba")).toBe("/test");
    expect(getRouteKeyForPath("pt-BR", "/pt-BR/configuracoes")).toBe(
      "/settings",
    );
    expect(getRouteKeyForPath("pt-BR", "/pt-BR/entrar")).toBe("/login");
    expect(getRouteKeyForPath("pt-BR", "/pt-BR/cadastro")).toBe("/register");
    expect(getRouteKeyForPath("pt-BR", "/pt-BR/teste")).toBe("/test");
    expect(getRouteKeyForPath("id", "/id/pengaturan")).toBe("/settings");
    expect(getRouteKeyForPath("id", "/id/masuk")).toBe("/login");
    expect(getRouteKeyForPath("id", "/id/daftar")).toBe("/register");
    expect(getRouteKeyForPath("id", "/id/uji")).toBe("/test");
    expect(getRouteKeyForPath("hi", "/hi/सेटिंग्स")).toBe("/settings");
    expect(getRouteKeyForPath("hi", "/hi/लॉगिन")).toBe("/login");
    expect(getRouteKeyForPath("hi", "/hi/पंजीकरण")).toBe("/register");
    expect(getRouteKeyForPath("hi", "/hi/परीक्षण")).toBe("/test");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/设置")).toBe("/settings");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/登录")).toBe("/login");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/注册")).toBe("/register");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/测试")).toBe("/test");
    expect(getRouteKeyForPath("ja", "/ja/設定")).toBe("/settings");
    expect(getRouteKeyForPath("ja", "/ja/ログイン")).toBe("/login");
    expect(getRouteKeyForPath("ja", "/ja/登録")).toBe("/register");
    expect(getRouteKeyForPath("ja", "/ja/テスト")).toBe("/test");
    expect(getRouteKeyForPath("ko", "/ko/설정")).toBe("/settings");
    expect(getRouteKeyForPath("ko", "/ko/로그인")).toBe("/login");
    expect(getRouteKeyForPath("ko", "/ko/회원가입")).toBe("/register");
    expect(getRouteKeyForPath("ko", "/ko/테스트")).toBe("/test");
    expect(getRouteKeyForPath("tr", "/tr/ayarlar")).toBe("/settings");
    expect(getRouteKeyForPath("tr", "/tr/giriş")).toBe("/login");
    expect(getRouteKeyForPath("tr", "/tr/kayıt")).toBe("/register");
    expect(getRouteKeyForPath("tr", "/tr/test")).toBe("/test");
    expect(getRouteKeyForPath("vi", "/vi/cai-dat")).toBe("/settings");
    expect(getRouteKeyForPath("vi", "/vi/dang-nhap")).toBe("/login");
    expect(getRouteKeyForPath("vi", "/vi/dang-ky")).toBe("/register");
    expect(getRouteKeyForPath("vi", "/vi/kiem-tra")).toBe("/test");
    expect(getRouteKeyForPath("it", "/it/impostazioni")).toBe("/settings");
    expect(getRouteKeyForPath("it", "/it/accesso")).toBe("/login");
    expect(getRouteKeyForPath("it", "/it/registrazione")).toBe("/register");
    expect(getRouteKeyForPath("it", "/it/test")).toBe("/test");
    expect(getRouteKeyForPath("pl", "/pl/ustawienia")).toBe("/settings");
    expect(getRouteKeyForPath("pl", "/pl/logowanie")).toBe("/login");
    expect(getRouteKeyForPath("pl", "/pl/rejestracja")).toBe("/register");
    expect(getRouteKeyForPath("pl", "/pl/test")).toBe("/test");
    expect(getRouteKeyForPath("uk", "/uk/налаштування")).toBe("/settings");
    expect(getRouteKeyForPath("uk", "/uk/вхід")).toBe("/login");
    expect(getRouteKeyForPath("uk", "/uk/реєстрація")).toBe("/register");
    expect(getRouteKeyForPath("uk", "/uk/тест")).toBe("/test");
    expect(getRouteKeyForPath("nl", "/nl/instellingen")).toBe("/settings");
    expect(getRouteKeyForPath("nl", "/nl/inloggen")).toBe("/login");
    expect(getRouteKeyForPath("nl", "/nl/registreren")).toBe("/register");
    expect(getRouteKeyForPath("nl", "/nl/test")).toBe("/test");
    expect(getRouteKeyForPath("ru", "/ru/настройки")).toBe("/settings");
    expect(getRouteKeyForPath("ru", "/ru/вход")).toBe("/login");
    expect(getRouteKeyForPath("ru", "/ru/регистрация")).toBe("/register");
    expect(getRouteKeyForPath("ru", "/ru/тест")).toBe("/test");
    expect(getRouteKeyForPath("he", "/he/הגדרות")).toBe("/settings");
    expect(getRouteKeyForPath("he", "/he/התחברות")).toBe("/login");
    expect(getRouteKeyForPath("he", "/he/הרשמה")).toBe("/register");
    expect(getRouteKeyForPath("he", "/he/בדיקה")).toBe("/test");
    expect(getRouteKeyForPath("en", "/en/unknown")).toBeNull();
    expect(
      getRouteKeyForPath(
        "ar",
        "/ar/%D8%A7%D9%84%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA",
      ),
    ).toBe("/settings");

    expect(resolveLocalizedRestPath("/einstellungen", "en", "de")).toBe(
      "/settings",
    );
    expect(resolveLocalizedRestPath("/login", "de")).toBe("/anmelden");
    expect(resolveLocalizedRestPath("/login", "fr")).toBe("/connexion");
    expect(resolveLocalizedRestPath("/register", "fr")).toBe("/inscription");
    expect(resolveLocalizedRestPath("/login", "es")).toBe("/iniciar-sesion");
    expect(resolveLocalizedRestPath("/register", "es")).toBe("/registro");
    expect(resolveLocalizedRestPath("/test", "es")).toBe("/prueba");
    expect(resolveLocalizedRestPath("/login", "pt-BR")).toBe("/entrar");
    expect(resolveLocalizedRestPath("/register", "pt-BR")).toBe("/cadastro");
    expect(resolveLocalizedRestPath("/test", "pt-BR")).toBe("/teste");
    expect(resolveLocalizedRestPath("/login", "id")).toBe("/masuk");
    expect(resolveLocalizedRestPath("/register", "id")).toBe("/daftar");
    expect(resolveLocalizedRestPath("/test", "id")).toBe("/uji");
    expect(resolveLocalizedRestPath("/login", "hi")).toBe("/लॉगिन");
    expect(resolveLocalizedRestPath("/register", "hi")).toBe("/पंजीकरण");
    expect(resolveLocalizedRestPath("/test", "hi")).toBe("/परीक्षण");
    expect(resolveLocalizedRestPath("/login", "zh-CN")).toBe("/登录");
    expect(resolveLocalizedRestPath("/register", "zh-CN")).toBe("/注册");
    expect(resolveLocalizedRestPath("/test", "zh-CN")).toBe("/测试");
    expect(resolveLocalizedRestPath("/login", "ja")).toBe("/ログイン");
    expect(resolveLocalizedRestPath("/register", "ja")).toBe("/登録");
    expect(resolveLocalizedRestPath("/test", "ja")).toBe("/テスト");
    expect(resolveLocalizedRestPath("/login", "ko")).toBe("/로그인");
    expect(resolveLocalizedRestPath("/register", "ko")).toBe("/회원가입");
    expect(resolveLocalizedRestPath("/test", "ko")).toBe("/테스트");
    expect(resolveLocalizedRestPath("/login", "tr")).toBe("/giriş");
    expect(resolveLocalizedRestPath("/register", "tr")).toBe("/kayıt");
    expect(resolveLocalizedRestPath("/test", "tr")).toBe("/test");
    expect(resolveLocalizedRestPath("/login", "vi")).toBe("/dang-nhap");
    expect(resolveLocalizedRestPath("/register", "vi")).toBe("/dang-ky");
    expect(resolveLocalizedRestPath("/test", "vi")).toBe("/kiem-tra");
    expect(resolveLocalizedRestPath("/login", "it")).toBe("/accesso");
    expect(resolveLocalizedRestPath("/register", "it")).toBe("/registrazione");
    expect(resolveLocalizedRestPath("/test", "it")).toBe("/test");
    expect(resolveLocalizedRestPath("/login", "pl")).toBe("/logowanie");
    expect(resolveLocalizedRestPath("/register", "pl")).toBe("/rejestracja");
    expect(resolveLocalizedRestPath("/test", "pl")).toBe("/test");
    expect(resolveLocalizedRestPath("/login", "uk")).toBe("/вхід");
    expect(resolveLocalizedRestPath("/register", "uk")).toBe("/реєстрація");
    expect(resolveLocalizedRestPath("/test", "uk")).toBe("/тест");
    expect(resolveLocalizedRestPath("/login", "nl")).toBe("/inloggen");
    expect(resolveLocalizedRestPath("/register", "nl")).toBe("/registreren");
    expect(resolveLocalizedRestPath("/test", "nl")).toBe("/test");
    expect(resolveLocalizedRestPath("/login", "ru")).toBe("/вход");
    expect(resolveLocalizedRestPath("/register", "ru")).toBe("/регистрация");
    expect(resolveLocalizedRestPath("/test", "ru")).toBe("/тест");
    expect(resolveLocalizedRestPath("/login", "he")).toBe("/התחברות");
    expect(resolveLocalizedRestPath("/register", "he")).toBe("/הרשמה");
    expect(resolveLocalizedRestPath("/test", "he")).toBe("/בדיקה");
    expect(resolveLocalizedRestPath("/unknown/", "de", "en")).toBe("/unknown");
    expect(resolveLocalizedRestPath("/", "de", "en")).toBe("/");
    expect(getLocalizedLoginPath("de")).toBe("/anmelden");
    expect(getLocalizedLoginPath("fr")).toBe("/connexion");
    expect(getLocalizedLoginPath("es")).toBe("/iniciar-sesion");
    expect(getLocalizedLoginPath("pt-BR")).toBe("/entrar");
    expect(getLocalizedLoginPath("id")).toBe("/masuk");
    expect(getLocalizedLoginPath("hi")).toBe("/लॉगिन");
    expect(getLocalizedLoginPath("zh-CN")).toBe("/登录");
    expect(getLocalizedLoginPath("ja")).toBe("/ログイン");
    expect(getLocalizedLoginPath("ko")).toBe("/로그인");
    expect(getLocalizedLoginPath("tr")).toBe("/giriş");
    expect(getLocalizedLoginPath("vi")).toBe("/dang-nhap");
    expect(getLocalizedLoginPath("it")).toBe("/accesso");
    expect(getLocalizedLoginPath("pl")).toBe("/logowanie");
    expect(getLocalizedLoginPath("uk")).toBe("/вхід");
    expect(getLocalizedLoginPath("nl")).toBe("/inloggen");
    expect(getLocalizedLoginPath("ru")).toBe("/вход");
    expect(getLocalizedLoginPath("he")).toBe("/התחברות");
    expect(getLocalizedLoginPath("ar")).toBe("/تسجيل-الدخول");
    expect(getRouteMatchForPath("de", "/de/settings")).toEqual({
      routeKey: "/settings",
      isAlias: true,
    });
    expect(resolveLocalizedRestPath("/settings", "de", "de")).toBe(
      "/einstellungen",
    );
  });

  it("normalizes Unicode route segments safely for lookup", () => {
    expect(normalizeRoutePathForLookup("/الإعدادات/")).toBe("/الإعدادات");
    expect(
      normalizeRoutePathForLookup(
        "/%D8%A7%D9%84%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA",
      ),
    ).toBe("/الإعدادات");
    expect(normalizeRoutePathForLookup("/e\u0301")).toBe("/é");
    expect(normalizeRoutePathForLookup("/broken%E0%A4%A")).toBeNull();
    expect(normalizeRoutePathForLookup("/encoded%2Fseparator")).toBeNull();
    expect(normalizeRoutePathForLookup("/encoded%5Cseparator")).toBeNull();
    expect(normalizeRoutePathForLookup("/encoded%252Fseparator")).toBe(
      "/encoded%2Fseparator",
    );
  });

  it("rejects canonical and alias collisions within a locale", () => {
    expect(() =>
      buildRoutePathLookup([
        {
          locale: "de",
          path: "/konflikt",
          routeKey: "/settings",
          isAlias: false,
        },
        {
          locale: "de",
          path: "/konflikt",
          routeKey: "/login",
          isAlias: true,
        },
      ]),
    ).toThrow(/route collision/i);
  });

  it("detects collisions after Unicode normalization", () => {
    expect(() =>
      buildRoutePathLookup([
        {
          locale: "ar",
          path: "/é",
          routeKey: "/settings",
          isAlias: false,
        },
        {
          locale: "ar",
          path: "/e\u0301",
          routeKey: "/login",
          isAlias: true,
        },
      ]),
    ).toThrow(/route collision/i);
  });

  it("allows the same slug to identify different routes across locales", () => {
    const lookup = buildRoutePathLookup([
      {
        locale: "en",
        path: "/shared",
        routeKey: "/settings",
        isAlias: false,
      },
      {
        locale: "de",
        path: "/shared",
        routeKey: "/login",
        isAlias: false,
      },
    ]);

    expect(lookup.en["/shared"]).toEqual({
      routeKey: "/settings",
      isAlias: false,
    });
    expect(lookup.de["/shared"]).toEqual({
      routeKey: "/login",
      isAlias: false,
    });
  });

  it("does not reinterpret another locale's canonical slug without a source locale", () => {
    expect(resolveLocalizedRestPath("/einstellungen", "en")).toBe(
      "/einstellungen",
    );
    expect(resolveLocalizedRestPath("/einstellungen", "en", "de")).toBe(
      "/settings",
    );
  });

  it("uses only supported response locales", () => {
    const germanResponse = {
      headers: new Headers({ "x-next-intl-locale": "de" }),
    } as unknown as NextResponse;
    const invalidResponse = {
      headers: new Headers({ "x-next-intl-locale": "invalid_locale" }),
    } as unknown as NextResponse;

    expect(getCurrentLocaleFromResponse(germanResponse, "en")).toBe("de");
    expect(getCurrentLocaleFromResponse(invalidResponse, "en")).toBe("en");
  });

  it.each([
    ["/", "/de"],
    ["/einstellungen", "/de/einstellungen"],
  ])(
    "builds redirect for %j while preserving request search and hash",
    (localizedRest, expectedPath) => {
      const nextUrl = new URL(
        "https://example.test/en/settings?tab=notifications#mail",
      );
      const request = {
        nextUrl,
        url: "https://example.test/en/settings?stale=1#old",
      } as unknown as NextRequest;

      const redirect = buildRedirectUrl(request, "de", localizedRest);

      expect(redirect.pathname).toBe(expectedPath);
      expect(redirect.search).toBe("?tab=notifications");
      expect(redirect.hash).toBe("#mail");
    },
  );
});

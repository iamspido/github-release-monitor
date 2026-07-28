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
    ["/zh-cn/设置", { locale: "zh-CN", restPath: "/设置" }],
    ["/JA/設定", { locale: "ja", restPath: "/設定" }],
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
    expect(getRouteAliases("/settings", "zh-CN")).toContain("/settings");
    expect(getRouteAliases("/settings", "ja")).toContain("/settings");
    expect(getRouteAliases("/settings", "ar")).toContain("/settings");
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
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/设置")).toBe("/settings");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/登录")).toBe("/login");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/注册")).toBe("/register");
    expect(getRouteKeyForPath("zh-CN", "/zh-CN/测试")).toBe("/test");
    expect(getRouteKeyForPath("ja", "/ja/設定")).toBe("/settings");
    expect(getRouteKeyForPath("ja", "/ja/ログイン")).toBe("/login");
    expect(getRouteKeyForPath("ja", "/ja/登録")).toBe("/register");
    expect(getRouteKeyForPath("ja", "/ja/テスト")).toBe("/test");
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
    expect(resolveLocalizedRestPath("/login", "zh-CN")).toBe("/登录");
    expect(resolveLocalizedRestPath("/register", "zh-CN")).toBe("/注册");
    expect(resolveLocalizedRestPath("/test", "zh-CN")).toBe("/测试");
    expect(resolveLocalizedRestPath("/login", "ja")).toBe("/ログイン");
    expect(resolveLocalizedRestPath("/register", "ja")).toBe("/登録");
    expect(resolveLocalizedRestPath("/test", "ja")).toBe("/テスト");
    expect(resolveLocalizedRestPath("/unknown/", "de", "en")).toBe("/unknown");
    expect(resolveLocalizedRestPath("/", "de", "en")).toBe("/");
    expect(getLocalizedLoginPath("de")).toBe("/anmelden");
    expect(getLocalizedLoginPath("fr")).toBe("/connexion");
    expect(getLocalizedLoginPath("es")).toBe("/iniciar-sesion");
    expect(getLocalizedLoginPath("pt-BR")).toBe("/entrar");
    expect(getLocalizedLoginPath("id")).toBe("/masuk");
    expect(getLocalizedLoginPath("zh-CN")).toBe("/登录");
    expect(getLocalizedLoginPath("ja")).toBe("/ログイン");
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
      headers: new Headers({ "x-next-intl-locale": "it" }),
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

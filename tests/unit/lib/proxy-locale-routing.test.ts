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
  });

  it("resolves route keys and localized paths in both directions", () => {
    expect(getRouteKeyForPath("de", "/de/einstellungen")).toBe("/settings");
    expect(getRouteKeyForPath("en", "/en/login")).toBe("/login");
    expect(getRouteKeyForPath("en", "/en/unknown")).toBeNull();

    expect(resolveLocalizedRestPath("/einstellungen", "en", "de")).toBe(
      "/settings",
    );
    expect(resolveLocalizedRestPath("/login", "de")).toBe("/anmelden");
    expect(resolveLocalizedRestPath("/unknown/", "de", "en")).toBe("/unknown");
    expect(resolveLocalizedRestPath("/", "de", "en")).toBe("/");
    expect(getLocalizedLoginPath("de")).toBe("/anmelden");
    expect(getRouteMatchForPath("de", "/de/settings")).toEqual({
      routeKey: "/settings",
      isAlias: true,
    });
    expect(resolveLocalizedRestPath("/settings", "de", "de")).toBe(
      "/einstellungen",
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
      headers: new Headers({ "x-next-intl-locale": "fr" }),
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

import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  englishLocale,
  getLocaleMetadata,
  isSupportedLocale,
  localeMetadata,
  localeRegistry,
  locales,
  normalizeLocale,
  parseLocale,
} from "@/i18n/config";

describe("i18n locale config", () => {
  it("parses configured locales case-insensitively and returns canonical codes", () => {
    expect(parseLocale(" EN ")).toBe("en");
    expect(parseLocale("De")).toBe("de");
    expect(parseLocale("FR")).toBe("fr");
    expect(parseLocale("ES")).toBe("es");
    expect(parseLocale("PT-br")).toBe("pt-BR");
    expect(parseLocale("ZH-cn")).toBe("zh-CN");
    expect(parseLocale("AR")).toBe("ar");
    expect(parseLocale("it")).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });

  it("normalizes invalid locale input to the configured default", () => {
    expect(normalizeLocale("unsupported")).toBe(defaultLocale);
    expect(isSupportedLocale("de")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("pt-BR")).toBe(true);
    expect(isSupportedLocale("zh-CN")).toBe(true);
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("pt-br")).toBe(false);
    expect(isSupportedLocale("zh-cn")).toBe(false);
    expect(isSupportedLocale("DE")).toBe(false);
    expect(isSupportedLocale("it")).toBe(false);
  });

  it("provides complete metadata for every locale", () => {
    expect(localeRegistry.map(({ code }) => code)).toEqual(locales);
    expect(localeMetadata.map(({ code }) => code)).toEqual(locales);
    expect(getLocaleMetadata("en")).toMatchObject({
      code: "en",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("de")).toMatchObject({
      code: "de",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("fr")).toMatchObject({
      code: "fr",
      nativeName: "Français",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("es")).toMatchObject({
      code: "es",
      nativeName: "Español",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("pt-BR")).toMatchObject({
      code: "pt-BR",
      nativeName: "Português (Brasil)",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("zh-CN")).toMatchObject({
      code: "zh-CN",
      nativeName: "简体中文",
      direction: "ltr",
      fontProfile: "noto-cjk",
    });
    expect(getLocaleMetadata("ar")).toMatchObject({
      code: "ar",
      nativeName: "العربية",
      direction: "rtl",
      fontProfile: "noto-arabic",
    });
  });

  it("uses unique canonical BCP 47 locale codes", () => {
    expect(new Set(locales).size).toBe(locales.length);
    expect(englishLocale).toBe("en");
    for (const locale of locales) {
      expect(Intl.getCanonicalLocales(locale)).toEqual([locale]);
    }
  });
});

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
    expect(parseLocale("ID")).toBe("id");
    expect(parseLocale("HI")).toBe("hi");
    expect(parseLocale("ZH-cn")).toBe("zh-CN");
    expect(parseLocale("JA")).toBe("ja");
    expect(parseLocale("KO")).toBe("ko");
    expect(parseLocale("TR")).toBe("tr");
    expect(parseLocale("VI")).toBe("vi");
    expect(parseLocale("IT")).toBe("it");
    expect(parseLocale("PL")).toBe("pl");
    expect(parseLocale("UK")).toBe("uk");
    expect(parseLocale("NL")).toBe("nl");
    expect(parseLocale("RU")).toBe("ru");
    expect(parseLocale("HE")).toBe("he");
    expect(parseLocale("AR")).toBe("ar");
    expect(parseLocale("invalid_locale")).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });

  it("normalizes invalid locale input to the configured default", () => {
    expect(normalizeLocale("unsupported")).toBe(defaultLocale);
    expect(isSupportedLocale("de")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("pt-BR")).toBe(true);
    expect(isSupportedLocale("id")).toBe(true);
    expect(isSupportedLocale("hi")).toBe(true);
    expect(isSupportedLocale("zh-CN")).toBe(true);
    expect(isSupportedLocale("ja")).toBe(true);
    expect(isSupportedLocale("ko")).toBe(true);
    expect(isSupportedLocale("tr")).toBe(true);
    expect(isSupportedLocale("vi")).toBe(true);
    expect(isSupportedLocale("it")).toBe(true);
    expect(isSupportedLocale("pl")).toBe(true);
    expect(isSupportedLocale("uk")).toBe(true);
    expect(isSupportedLocale("nl")).toBe(true);
    expect(isSupportedLocale("ru")).toBe(true);
    expect(isSupportedLocale("he")).toBe(true);
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("pt-br")).toBe(false);
    expect(isSupportedLocale("zh-cn")).toBe(false);
    expect(isSupportedLocale("DE")).toBe(false);
    expect(isSupportedLocale("invalid_locale")).toBe(false);
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
    expect(getLocaleMetadata("id")).toMatchObject({
      code: "id",
      nativeName: "Bahasa Indonesia",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("hi")).toMatchObject({
      code: "hi",
      nativeName: "हिन्दी",
      direction: "ltr",
      fontProfile: "noto-devanagari",
    });
    expect(getLocaleMetadata("zh-CN")).toMatchObject({
      code: "zh-CN",
      nativeName: "简体中文",
      direction: "ltr",
      fontProfile: "noto-cjk-sc",
    });
    expect(getLocaleMetadata("ja")).toMatchObject({
      code: "ja",
      nativeName: "日本語",
      direction: "ltr",
      fontProfile: "noto-cjk-jp",
    });
    expect(getLocaleMetadata("ko")).toMatchObject({
      code: "ko",
      nativeName: "한국어",
      direction: "ltr",
      fontProfile: "noto-cjk-kr",
    });
    expect(getLocaleMetadata("tr")).toMatchObject({
      code: "tr",
      nativeName: "Türkçe",
      direction: "ltr",
      fontProfile: "noto",
    });
    expect(getLocaleMetadata("vi")).toMatchObject({
      code: "vi",
      nativeName: "Tiếng Việt",
      direction: "ltr",
      fontProfile: "noto",
    });
    expect(getLocaleMetadata("it")).toMatchObject({
      code: "it",
      nativeName: "Italiano",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("pl")).toMatchObject({
      code: "pl",
      nativeName: "Polski",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("uk")).toMatchObject({
      code: "uk",
      nativeName: "Українська",
      direction: "ltr",
      fontProfile: "noto",
    });
    expect(getLocaleMetadata("nl")).toMatchObject({
      code: "nl",
      nativeName: "Nederlands",
      direction: "ltr",
      fontProfile: "inter",
    });
    expect(getLocaleMetadata("ru")).toMatchObject({
      code: "ru",
      nativeName: "Русский",
      direction: "ltr",
      fontProfile: "noto",
    });
    expect(getLocaleMetadata("he")).toMatchObject({
      code: "he",
      nativeName: "עברית",
      direction: "rtl",
      fontProfile: "noto-hebrew",
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

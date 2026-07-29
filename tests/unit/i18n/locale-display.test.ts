import { describe, expect, it } from "vitest";
import { localeMetadata } from "@/i18n/config";
import { localeDisplayMetadata } from "@/i18n/locale-display";

describe("locale display order", () => {
  it("keeps English first and sorts the remaining native names", () => {
    expect(localeDisplayMetadata.map(({ code }) => code)).toEqual([
      "en",
      "id",
      "de",
      "es",
      "fr",
      "it",
      "nl",
      "pl",
      "pt-BR",
      "vi",
      "tr",
      "ru",
      "uk",
      "he",
      "ar",
      "hi",
      "ko",
      "ja",
      "zh-CN",
    ]);
  });

  it("does not change the technical registry order", () => {
    expect(localeMetadata.map(({ code }) => code)).toEqual([
      "en",
      "de",
      "fr",
      "es",
      "pt-BR",
      "id",
      "hi",
      "zh-CN",
      "ja",
      "ko",
      "tr",
      "vi",
      "it",
      "pl",
      "uk",
      "nl",
      "ru",
      "he",
      "ar",
    ]);
  });
});

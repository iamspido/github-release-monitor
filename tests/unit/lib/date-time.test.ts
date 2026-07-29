import { describe, expect, it } from "vitest";
import { type Locale, locales } from "@/i18n/config";
import { formatAbsoluteDateTime } from "@/lib/date-time";

describe("date-time formatting", () => {
  const instant = new Date("2026-01-15T18:05:07.000Z");
  const localeTimeCases: ReadonlyArray<{
    locale: Locale;
    time: RegExp;
    twelveHourMarker?: RegExp;
  }> = [
    { locale: "en", time: /\d{1,2}:\d{2}/, twelveHourMarker: /AM|PM/i },
    { locale: "de", time: /\d{1,2}:\d{2}/ },
    { locale: "fr", time: /\d{1,2}:\d{2}/ },
    {
      locale: "es",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /[ap]\.?\s*m\.?/iu,
    },
    {
      locale: "pt-BR",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /[ap]\.?\s*m\.?/iu,
    },
    { locale: "id", time: /\d{1,2}\.\d{2}/, twelveHourMarker: /AM|PM/iu },
    { locale: "hi", time: /\d{1,2}:\d{2}/, twelveHourMarker: /AM|PM/iu },
    {
      locale: "zh-CN",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /上午|下午/u,
    },
    {
      locale: "ja",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /午前|午後/u,
    },
    {
      locale: "ko",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /오전|오후/u,
    },
    { locale: "tr", time: /\d{1,2}:\d{2}/, twelveHourMarker: /ÖÖ|ÖS/u },
    { locale: "vi", time: /\d{1,2}:\d{2}/, twelveHourMarker: /SA|CH/u },
    { locale: "it", time: /\d{1,2}:\d{2}/, twelveHourMarker: /AM|PM/u },
    { locale: "pl", time: /\d{1,2}:\d{2}/, twelveHourMarker: /AM|PM/u },
    { locale: "uk", time: /\d{1,2}:\d{2}/, twelveHourMarker: /дп|пп/iu },
    {
      locale: "nl",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /[ap]\.?\s*m\.?/iu,
    },
    { locale: "ru", time: /\d{1,2}:\d{2}/, twelveHourMarker: /AM|PM/iu },
    {
      locale: "he",
      time: /\d{1,2}:\d{2}/,
      twelveHourMarker: /לפנה״צ|אחה״צ|AM|PM/u,
    },
    {
      locale: "ar",
      time: /[0-9٠-٩]{1,2}:[0-9٠-٩]{2}/u,
      twelveHourMarker: /(?:^|\s)[صم](?:\s|$)/u,
    },
  ];

  it("uses the requested browser timezone for the same instant", () => {
    const berlin = formatAbsoluteDateTime(instant, {
      locale: "en",
      timeFormat: "24h",
      timeZone: "Europe/Berlin",
      format: { hour: "2-digit", minute: "2-digit" },
    });
    const newYork = formatAbsoluteDateTime(instant, {
      locale: "en",
      timeFormat: "24h",
      timeZone: "America/New_York",
      format: { hour: "2-digit", minute: "2-digit" },
    });

    expect(berlin).not.toBe(newYork);
    expect(berlin).not.toMatch(/AM|PM/i);
    expect(newYork).not.toMatch(/AM|PM/i);
  });

  it("honors 12h and 24h independently from timezone", () => {
    const twelveHour = formatAbsoluteDateTime(instant, {
      locale: "en",
      timeFormat: "12h",
      timeZone: "UTC",
      format: { hour: "numeric", minute: "2-digit" },
    });
    const twentyFourHour = formatAbsoluteDateTime(instant, {
      locale: "en",
      timeFormat: "24h",
      timeZone: "UTC",
      format: { hour: "numeric", minute: "2-digit" },
    });

    expect(twelveHour).toMatch(/AM|PM/i);
    expect(twentyFourHour).not.toMatch(/AM|PM/i);
  });

  it("defines time-format expectations for every published locale", () => {
    expect(new Set(localeTimeCases.map(({ locale }) => locale))).toEqual(
      new Set(locales),
    );
  });

  it.each(localeTimeCases)(
    "honors locale-specific 12h and 24h conventions for $locale",
    ({ locale, time, twelveHourMarker }) => {
      const twelveHour = formatAbsoluteDateTime(instant, {
        locale,
        timeFormat: "12h",
        timeZone: "UTC",
        format: { hour: "numeric", minute: "2-digit" },
      });
      const twentyFourHour = formatAbsoluteDateTime(instant, {
        locale,
        timeFormat: "24h",
        timeZone: "UTC",
        format: { hour: "numeric", minute: "2-digit" },
      });

      expect(twelveHour).toMatch(time);
      expect(twentyFourHour).toMatch(time);
      expect(twelveHour).not.toBe(twentyFourHour);
      if (twelveHourMarker) {
        expect(twelveHour).toMatch(twelveHourMarker);
        expect(twentyFourHour).not.toMatch(twelveHourMarker);
      }
    },
  );

  it("applies daylight-saving offsets from the IANA timezone", () => {
    const winter = formatAbsoluteDateTime(
      new Date("2026-01-15T12:00:00.000Z"),
      {
        locale: "en",
        timeFormat: "24h",
        timeZone: "Europe/Berlin",
        format: { hour: "2-digit", minute: "2-digit" },
      },
    );
    const summer = formatAbsoluteDateTime(
      new Date("2026-07-15T12:00:00.000Z"),
      {
        locale: "en",
        timeFormat: "24h",
        timeZone: "Europe/Berlin",
        format: { hour: "2-digit", minute: "2-digit" },
      },
    );

    expect(winter).toContain("13");
    expect(summer).toContain("14");
  });
});

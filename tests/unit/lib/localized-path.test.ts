import {
  getSupportedLocalePrefix,
  stripLocalePrefix,
} from "@/lib/localized-path";

describe("localized-path", () => {
  it("classifies only supported full locale path segments", () => {
    expect(getSupportedLocalePrefix("/en/settings")).toBe("en");
    expect(getSupportedLocalePrefix("/de?source=login")).toBe("de");
    expect(getSupportedLocalePrefix("/fr/settings")).toBe("fr");
    expect(getSupportedLocalePrefix("/es/settings")).toBe("es");
    expect(getSupportedLocalePrefix("/ID/pengaturan")).toBe("id");
    expect(getSupportedLocalePrefix("/HI/सेटिंग्स")).toBe("hi");
    expect(getSupportedLocalePrefix("/KO/설정")).toBe("ko");
    expect(getSupportedLocalePrefix("/TR/ayarlar")).toBe("tr");
    expect(getSupportedLocalePrefix("/VI/cai-dat")).toBe("vi");
    expect(getSupportedLocalePrefix("/IT/impostazioni")).toBe("it");
    expect(getSupportedLocalePrefix("/PL/ustawienia")).toBe("pl");
    expect(getSupportedLocalePrefix("/UK/налаштування")).toBe("uk");
    expect(getSupportedLocalePrefix("/NL/instellingen")).toBe("nl");
    expect(getSupportedLocalePrefix("/RU/настройки")).toBe("ru");
    expect(getSupportedLocalePrefix("/HE/הגדרות")).toBe("he");
    expect(getSupportedLocalePrefix("/invalid_locale/settings")).toBeNull();
    expect(getSupportedLocalePrefix("/unexpected")).toBeNull();
    expect(getSupportedLocalePrefix("/enterprise")).toBeNull();
    expect(getSupportedLocalePrefix("en/settings")).toBeNull();
  });

  it("strips only the requested full locale prefix", () => {
    expect(stripLocalePrefix("/en/settings", "en")).toBe("/settings");
    expect(stripLocalePrefix("/en", "en")).toBe("/");
    expect(stripLocalePrefix("/en?source=login", "en")).toBe("/?source=login");
    expect(stripLocalePrefix("/enterprise", "en")).toBe("/enterprise");
    expect(stripLocalePrefix("/de/settings", "en")).toBe("/de/settings");
  });
});

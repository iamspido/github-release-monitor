import {
  getSupportedLocalePrefix,
  stripLocalePrefix,
} from "@/lib/localized-path";

describe("localized-path", () => {
  it("classifies only supported full locale path segments", () => {
    expect(getSupportedLocalePrefix("/en/settings")).toBe("en");
    expect(getSupportedLocalePrefix("/de?source=login")).toBe("de");
    expect(getSupportedLocalePrefix("/enterprise")).toBeNull();
    expect(getSupportedLocalePrefix("en/settings")).toBeNull();
  });

  it("strips only the requested full locale prefix", () => {
    expect(stripLocalePrefix("/en/settings", "en")).toBe("/settings");
    expect(stripLocalePrefix("/en", "en")).toBe("/");
    expect(stripLocalePrefix("/en?source=login", "en")).toBe(
      "/?source=login",
    );
    expect(stripLocalePrefix("/enterprise", "en")).toBe("/enterprise");
    expect(stripLocalePrefix("/de/settings", "en")).toBe("/de/settings");
  });
});

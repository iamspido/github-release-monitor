import { describe, expect, it } from "vitest";
import { formatAbsoluteDateTime } from "@/lib/date-time";

describe("date-time formatting", () => {
  const instant = new Date("2026-01-15T18:05:07.000Z");

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

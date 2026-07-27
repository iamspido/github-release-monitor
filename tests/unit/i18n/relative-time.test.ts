import { createFormatter } from "next-intl";

describe("relative time formatting", () => {
  it("is identical for equivalent instants represented in different time zones", () => {
    const format = createFormatter({ locale: "en" });

    const berlinValue = new Date("2026-07-27T14:00:00+02:00");
    const berlinReference = new Date("2026-07-27T16:00:00+02:00");
    const newYorkValue = new Date("2026-07-27T08:00:00-04:00");
    const newYorkReference = new Date("2026-07-27T10:00:00-04:00");

    expect(berlinValue.getTime()).toBe(newYorkValue.getTime());
    expect(berlinReference.getTime()).toBe(newYorkReference.getTime());
    expect(format.relativeTime(berlinValue, berlinReference)).toBe(
      format.relativeTime(newYorkValue, newYorkReference),
    );
  });
});

import {
  buildCronExpression,
  cronPresetOptions,
  cronWeekdayOptions,
  inferCronParts,
  isValidFiveFieldCron,
} from "@/lib/settings/schedule-fields";

describe("settings/schedule-fields", () => {
  it("provides shared preset and weekday metadata in display order", () => {
    expect(cronPresetOptions.map((option) => option.value)).toEqual([
      "daily",
      "weekdays",
      "weekly",
      "custom",
    ]);
    expect(cronWeekdayOptions.map((option) => option.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "0",
    ]);
  });

  it("keeps the time from custom cron expressions when switching presets", () => {
    const parts = inferCronParts("30 9 */2 * *");

    expect(parts).toMatchObject({
      preset: "custom",
      time: "09:30",
      expression: "30 9 */2 * *",
    });
    expect(buildCronExpression("daily", parts.time, parts.weekday, "")).toBe(
      "30 9 * * *",
    );
  });

  it("falls back to the default time when custom cron time fields are complex", () => {
    expect(inferCronParts("*/15 9-17 * * 1-5")).toMatchObject({
      preset: "custom",
      time: "08:00",
      expression: "*/15 9-17 * * 1-5",
    });
  });

  it("rejects malformed five-field cron input on the client", () => {
    expect(isValidFiveFieldCron("0 8 * * *")).toBe(true);
    expect(isValidFiveFieldCron("0 8 * * *;rm")).toBe(false);
    expect(isValidFiveFieldCron("0 8 * *")).toBe(false);
  });
});

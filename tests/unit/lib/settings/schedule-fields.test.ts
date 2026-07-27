import {
  buildCronExpression,
  cronPresetOptions,
  cronWeekdayOptions,
  inferCronParts,
  inferCronPresetValue,
  inferCronWeekday,
  isValidFiveFieldCron,
  minutesToDhms,
  normalizeTimeInput,
  splitCronTime,
  timeToCronParts,
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

  it.each([
    [undefined, "daily"],
    ["0 8 * * *", "daily"],
    ["30 9 * * 1-5", "weekdays"],
    ["15 7 * * 0", "weekly"],
    ["0 8 */2 * *", "custom"],
    ["invalid", "custom"],
  ] as const)("infers preset %j as %s", (cron, expected) => {
    expect(inferCronPresetValue(cron)).toBe(expected);
  });

  it.each([
    ["0 8 * * 0", "0"],
    ["0 8 * * 6", "6"],
    ["0 8 * * *", "1"],
    ["invalid", "1"],
    [undefined, "1"],
  ] as const)("infers weekday from %j", (cron, expected) => {
    expect(inferCronWeekday(cron)).toBe(expected);
  });

  it.each([
    [undefined, "08:00"],
    ["30 9 * * *", "09:30"],
    ["bad bad * * *", "08:00"],
  ] as const)("splits cron time %j", (cron, expected) => {
    expect(splitCronTime(cron)).toBe(expected);
  });

  it("normalizes time input and decomposes intervals", () => {
    expect(normalizeTimeInput("07:05")).toBe("07:05");
    expect(normalizeTimeInput("7:05")).toBe("08:00");
    expect(timeToCronParts("07:05")).toEqual({ hour: 7, minute: 5 });
    expect(timeToCronParts("invalid")).toEqual({ hour: 8, minute: 0 });
    expect(minutesToDhms(2 * 24 * 60 + 3 * 60 + 4)).toEqual({
      d: 2,
      h: 3,
      m: 4,
    });
  });

  it.each([
    ["daily", "99:99", "1", "", "59 23 * * *"],
    ["weekdays", "07:05", "1", "", "5 7 * * 1-5"],
    ["weekly", "07:05", "6", "", "5 7 * * 6"],
    ["custom", "07:05", "1", "  */15   9-17 * * 1-5  ", "*/15 9-17 * * 1-5"],
  ] as const)(
    "builds a bounded %s cron expression",
    (preset, time, weekday, custom, expected) => {
      expect(buildCronExpression(preset, time, weekday, custom)).toBe(expected);
    },
  );

  it.each([
    [undefined, { preset: "daily", time: "08:00", weekday: "1" }],
    ["0 8 * * *", { preset: "daily", time: "08:00", weekday: "1" }],
    ["30 9 * * 1-5", { preset: "weekdays", time: "09:30", weekday: "1" }],
    ["15 7 * * 0", { preset: "weekly", time: "07:15", weekday: "0" }],
    [
      "0 24 * * *",
      {
        preset: "custom",
        time: "08:00",
        weekday: "1",
        expression: "0 24 * * *",
      },
    ],
    [
      "invalid",
      {
        preset: "custom",
        time: "08:00",
        weekday: "1",
        expression: "invalid",
      },
    ],
  ] as const)("infers complete cron parts for %j", (cron, expected) => {
    expect(inferCronParts(cron)).toMatchObject(expected);
  });

  it("rejects malformed five-field cron input on the client", () => {
    expect(isValidFiveFieldCron("0 8 * * *")).toBe(true);
    expect(isValidFiveFieldCron("   ")).toBe(false);
    expect(isValidFiveFieldCron("0 8 * * *;rm")).toBe(false);
    expect(isValidFiveFieldCron("0 8 * *")).toBe(false);
  });
});

import { CronExpressionParser } from "cron-parser";

export const MINUTES_IN_DAY = 24 * 60;
export const MINUTES_IN_HOUR = 60;
export const MAX_INTERVAL_MINUTES = 5_256_000;
export const defaultCronExpression = "0 8 * * *";

export type CronPreset = "daily" | "weekdays" | "weekly" | "custom";

export const cronPresetOptions = [
  { value: "daily", labelKey: "cron_preset_daily" },
  { value: "weekdays", labelKey: "cron_preset_weekdays" },
  { value: "weekly", labelKey: "cron_preset_weekly" },
  { value: "custom", labelKey: "cron_preset_custom" },
] as const satisfies ReadonlyArray<{
  value: CronPreset;
  labelKey: string;
}>;

export const cronWeekdayOptions = [
  { value: "1", labelKey: "cron_weekday_monday" },
  { value: "2", labelKey: "cron_weekday_tuesday" },
  { value: "3", labelKey: "cron_weekday_wednesday" },
  { value: "4", labelKey: "cron_weekday_thursday" },
  { value: "5", labelKey: "cron_weekday_friday" },
  { value: "6", labelKey: "cron_weekday_saturday" },
  { value: "0", labelKey: "cron_weekday_sunday" },
] as const;

// Keep the existing export for callers outside the application source.
export const weekdays = cronWeekdayOptions;

export function minutesToDhms(totalMinutes: number) {
  const d = Math.floor(totalMinutes / MINUTES_IN_DAY);
  const h = Math.floor((totalMinutes % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
  const m = totalMinutes % MINUTES_IN_HOUR;
  return { d, h, m };
}

export function normalizeTimeInput(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "08:00";
}

export function timeToCronParts(time: string) {
  const [hour = "8", minute = "0"] = normalizeTimeInput(time).split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

export function splitCronTime(cron?: string) {
  const [minute, hour] = (cron || defaultCronExpression).split(" ");
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  return `${String(Number.isFinite(h) ? h : 8).padStart(2, "0")}:${String(
    Number.isFinite(m) ? m : 0,
  ).padStart(2, "0")}`;
}

export function inferCronPresetValue(cron?: string): CronPreset {
  if (!cron) return "daily";
  const parts = cron.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length !== 5) return "custom";
  const [, , dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "daily";
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return "weekdays";
  }
  if (dayOfMonth === "*" && month === "*" && /^[0-6]$/.test(dayOfWeek)) {
    return "weekly";
  }
  return "custom";
}

export function inferCronWeekday(cron?: string) {
  const parts = cron?.trim().replace(/\s+/g, " ").split(" ") ?? [];
  return parts.length === 5 && /^[0-6]$/.test(parts[4]) ? parts[4] : "1";
}

export function inferCronParts(cron: string | undefined): {
  preset: CronPreset;
  time: string;
  weekday: string;
  expression: string;
} {
  const fallback = {
    preset: "daily" as CronPreset,
    time: "08:00",
    weekday: "1",
    expression: "",
  };
  if (!cron) return fallback;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ...fallback, preset: "custom", expression: cron };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const hasSimpleTime =
    Number.isInteger(hourNumber) &&
    hourNumber >= 0 &&
    hourNumber <= 23 &&
    Number.isInteger(minuteNumber) &&
    minuteNumber >= 0 &&
    minuteNumber <= 59;
  const time = hasSimpleTime
    ? `${String(hourNumber).padStart(2, "0")}:${String(minuteNumber).padStart(2, "0")}`
    : fallback.time;

  if (hasSimpleTime && dayOfMonth === "*" && month === "*") {
    if (dayOfWeek === "*") return { ...fallback, preset: "daily", time };
    if (dayOfWeek === "1-5") return { ...fallback, preset: "weekdays", time };
    if (/^[0-6]$/.test(dayOfWeek)) {
      return { ...fallback, preset: "weekly", time, weekday: dayOfWeek };
    }
  }

  return {
    ...fallback,
    preset: "custom",
    time,
    expression: cron,
  };
}

export function buildCronExpression(
  preset: CronPreset,
  time: string,
  weekday: string,
  customExpression: string,
) {
  if (preset === "custom") return customExpression.trim().replace(/\s+/g, " ");
  const { hour, minute } = timeToCronParts(time);
  const safeHour = Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 8;
  const safeMinute = Number.isFinite(minute)
    ? Math.min(Math.max(minute, 0), 59)
    : 0;
  if (preset === "weekdays") return `${safeMinute} ${safeHour} * * 1-5`;
  if (preset === "weekly") return `${safeMinute} ${safeHour} * * ${weekday}`;
  return `${safeMinute} ${safeHour} * * *`;
}

export function isValidFiveFieldCron(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return false;
  const parts = trimmed.split(" ");
  if (parts.length !== 5) return false;

  try {
    CronExpressionParser.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

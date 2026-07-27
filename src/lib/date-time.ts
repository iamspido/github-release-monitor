import type { Locale } from "@/i18n/config";
import type { TimeFormat } from "@/types";

type AbsoluteDateTimeOptions = Omit<
  Intl.DateTimeFormatOptions,
  "hour12" | "hourCycle" | "timeZone"
>;

export function formatAbsoluteDateTime(
  value: Date | number,
  options: {
    locale: Locale;
    timeFormat: TimeFormat;
    timeZone: string;
    format: AbsoluteDateTimeOptions;
  },
): string {
  return new Intl.DateTimeFormat(options.locale, {
    ...options.format,
    hour12: options.timeFormat === "12h",
    timeZone: options.timeZone,
  }).format(value);
}

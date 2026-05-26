"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TimeFormat } from "@/types";

const hours24 = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const hours12 = Array.from({ length: 12 }, (_, index) => String(index + 1));
const minutes = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

type Period = "AM" | "PM";

interface CronTimeSelectLabels {
  hour: string;
  minute: string;
  period: string;
  am: string;
  pm: string;
}

interface CronTimeSelectProps {
  disabled?: boolean;
  ids: {
    hour: string;
    minute: string;
    period: string;
  };
  labels: CronTimeSelectLabels;
  onChange: (value: string) => void;
  timeFormat: TimeFormat;
  value: string;
}

function normalizeTime(value: string) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value);
  const hour = match ? Number.parseInt(match[1], 10) : 8;
  const minute = match ? Number.parseInt(match[2], 10) : 0;
  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 8,
    minute: Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function to12Hour(hour24: number) {
  return {
    hour: String(hour24 % 12 || 12),
    period: (hour24 >= 12 ? "PM" : "AM") as Period,
  };
}

function from12Hour(hour12: string, period: Period) {
  const parsed = Number.parseInt(hour12, 10);
  const normalized = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 12)
    : 12;
  if (period === "AM") return normalized === 12 ? 0 : normalized;
  return normalized === 12 ? 12 : normalized + 12;
}

export function CronTimeSelect({
  disabled = false,
  ids,
  labels,
  onChange,
  timeFormat,
  value,
}: CronTimeSelectProps) {
  const parsed = normalizeTime(value);
  const selectedMinute = String(parsed.minute).padStart(2, "0");
  const selectedHour24 = String(parsed.hour).padStart(2, "0");
  const selected12 = to12Hour(parsed.hour);

  const handleHourChange = (nextHour: string) => {
    const nextHour24 =
      timeFormat === "12h"
        ? from12Hour(nextHour, selected12.period)
        : Number.parseInt(nextHour, 10);
    onChange(formatTime(nextHour24, parsed.minute));
  };

  const handleMinuteChange = (nextMinute: string) => {
    onChange(formatTime(parsed.hour, Number.parseInt(nextMinute, 10)));
  };

  const handlePeriodChange = (nextPeriod: Period) => {
    const nextHour24 = from12Hour(selected12.hour, nextPeriod);
    onChange(formatTime(nextHour24, parsed.minute));
  };

  return (
    <div
      className={
        timeFormat === "12h"
          ? "grid gap-3 sm:grid-cols-3"
          : "grid gap-3 sm:grid-cols-2"
      }
    >
      <div className="space-y-2">
        <Label htmlFor={ids.hour}>{labels.hour}</Label>
        <Select
          value={timeFormat === "12h" ? selected12.hour : selectedHour24}
          onValueChange={handleHourChange}
          disabled={disabled}
        >
          <SelectTrigger id={ids.hour}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(timeFormat === "12h" ? hours12 : hours24).map((hour) => (
              <SelectItem key={hour} value={hour}>
                {hour}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.minute}>{labels.minute}</Label>
        <Select
          value={selectedMinute}
          onValueChange={handleMinuteChange}
          disabled={disabled}
        >
          <SelectTrigger id={ids.minute}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {minutes.map((minute) => (
              <SelectItem key={minute} value={minute}>
                {minute}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {timeFormat === "12h" && (
        <div className="space-y-2">
          <Label htmlFor={ids.period}>{labels.period}</Label>
          <Select
            value={selected12.period}
            onValueChange={handlePeriodChange}
            disabled={disabled}
          >
            <SelectTrigger id={ids.period}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AM">{labels.am}</SelectItem>
              <SelectItem value="PM">{labels.pm}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

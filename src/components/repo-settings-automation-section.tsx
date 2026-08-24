"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { CronTimeSelect } from "@/components/cron-time-select";
import type { RepoSettingsAutomationController } from "@/components/repo-settings-section-controller-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type CronPreset,
  cronPresetOptions,
  cronWeekdayOptions,
  defaultCronExpression,
} from "@/lib/settings/schedule-fields";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";

type AutomationMode = "global" | "interval" | "cron";

export function RepoSettingsAutomationSection({
  controller,
  globalSettings,
}: {
  controller: RepoSettingsAutomationController;
  globalSettings: AppSettings;
}) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const {
    automationMode,
    cacheDays,
    cacheDaysId,
    cacheHours,
    cacheHoursId,
    cacheMinutes,
    cacheMinutesId,
    cacheOverrideId,
    cronError,
    cronExpression,
    cronExpressionId,
    cronHourId,
    cronMinuteId,
    cronPeriodId,
    cronPreset,
    cronPresetId,
    cronTime,
    cronWeekday,
    cronWeekdayId,
    handleResetAutomation,
    intervalDays,
    intervalDaysId,
    intervalError,
    intervalHours,
    intervalHoursId,
    intervalMinutes,
    intervalMinutesId,
    isCacheInvalid,
    isOnline,
    refreshModeId,
    requestImmediateSave,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setIntervalDays,
    setIntervalHours,
    setIntervalMinutes,
    setUseCustomCache,
    useCustomCache,
  } = controller;

  return (
    <div className="space-y-4 p-4 border rounded-md">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold text-base">{t("automation_title")}</h4>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleResetAutomation}
                className="size-8 shrink-0"
                disabled={!isOnline}
                aria-disabled={!isOnline}
              >
                <RotateCcw className="size-4" />
                <span className="sr-only">{t("reset_to_global_button")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("reset_to_global_tooltip")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("automation_description")}
      </p>

      <div className="space-y-2">
        <Label htmlFor={refreshModeId}>{t("automation_mode_label")}</Label>
        <Select
          value={automationMode}
          onValueChange={(value: AutomationMode) => {
            requestImmediateSave();
            setAutomationMode(value);
          }}
          disabled={!isOnline}
        >
          <SelectTrigger id={refreshModeId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">
              {globalSettings.backgroundCheckCron
                ? t("automation_mode_global_cron", {
                    cron: globalSettings.backgroundCheckCron,
                  })
                : t("automation_mode_global", {
                    count: globalSettings.refreshInterval,
                  })}
            </SelectItem>
            <SelectItem value="interval">
              {t("automation_mode_interval")}
            </SelectItem>
            <SelectItem value="cron">{t("automation_mode_cron")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {automationMode === "interval" && (
        <div>
          <Label>{t("custom_refresh_interval_label")}</Label>
          <div className="grid grid-cols-3 gap-3 mt-2">
            <div className="space-y-2">
              <Label htmlFor={intervalMinutesId}>
                {tGlobal("refresh_interval_minutes_label")}
              </Label>
              <Input
                id={intervalMinutesId}
                type="number"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                min={0}
                max={59}
                disabled={!isOnline}
                className={cn(
                  !!intervalError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={intervalHoursId}>
                {tGlobal("refresh_interval_hours_label")}
              </Label>
              <Input
                id={intervalHoursId}
                type="number"
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
                min={0}
                max={23}
                disabled={!isOnline}
                className={cn(
                  !!intervalError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={intervalDaysId}>
                {tGlobal("refresh_interval_days_label")}
              </Label>
              <Input
                id={intervalDaysId}
                type="number"
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                min={0}
                max={3650}
                disabled={!isOnline}
                className={cn(
                  !!intervalError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
          </div>
          {intervalError === "too_low" ? (
            <p className="mt-2 text-sm text-destructive">
              {tGlobal("refresh_interval_error_min")}
            </p>
          ) : intervalError === "too_high" ? (
            <p className="mt-2 text-sm text-destructive">
              {tGlobal("refresh_interval_error_max")}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {tGlobal("refresh_interval_hint")}
            </p>
          )}
        </div>
      )}

      {automationMode === "cron" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={cronPresetId}>{t("cron_preset_label")}</Label>
            <Select
              value={cronPreset}
              onValueChange={(value: CronPreset) => {
                requestImmediateSave();
                setCronPreset(value);
              }}
              disabled={!isOnline}
            >
              <SelectTrigger id={cronPresetId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cronPresetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {cronPreset !== "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("cron_time_label")}</Label>
                <CronTimeSelect
                  ids={{
                    hour: cronHourId,
                    minute: cronMinuteId,
                    period: cronPeriodId,
                  }}
                  labels={{
                    hour: tGlobal("cron_time_hour_label"),
                    minute: tGlobal("cron_time_minute_label"),
                    period: tGlobal("cron_time_period_label"),
                    am: tGlobal("cron_time_am"),
                    pm: tGlobal("cron_time_pm"),
                  }}
                  value={cronTime}
                  onChange={(value) => {
                    requestImmediateSave();
                    setCronTime(value);
                  }}
                  timeFormat={globalSettings.timeFormat}
                  disabled={!isOnline}
                />
              </div>
              {cronPreset === "weekly" && (
                <div className="space-y-2">
                  <Label htmlFor={cronWeekdayId}>
                    {t("cron_weekday_label")}
                  </Label>
                  <Select
                    value={cronWeekday}
                    onValueChange={(value) => {
                      requestImmediateSave();
                      setCronWeekday(value);
                    }}
                    disabled={!isOnline}
                  >
                    <SelectTrigger id={cronWeekdayId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cronWeekdayOptions.map((weekday) => (
                        <SelectItem key={weekday.value} value={weekday.value}>
                          {t(weekday.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {cronPreset === "custom" && (
            <div className="space-y-2">
              <Label htmlFor={cronExpressionId}>
                {t("cron_expression_label")}
              </Label>
              <Input
                id={cronExpressionId}
                dir="ltr"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder={defaultCronExpression}
                disabled={!isOnline}
                className={cn(
                  !!cronError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
          )}

          {cronError ? (
            <p className="text-sm text-destructive">
              {t("cron_error_invalid")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("cron_hint")}</p>
          )}
        </div>
      )}

      <div className="flex items-start gap-3 border-t pt-4">
        <Checkbox
          id={cacheOverrideId}
          checked={useCustomCache}
          onCheckedChange={(checked) => {
            requestImmediateSave();
            setUseCustomCache(Boolean(checked));
          }}
          disabled={!isOnline}
          className="mt-1"
        />
        <div className="grid gap-1.5 leading-none">
          <Label
            htmlFor={cacheOverrideId}
            className="font-medium cursor-pointer"
          >
            {t("custom_cache_label")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("custom_cache_description", {
              count: globalSettings.cacheInterval,
            })}
          </p>
        </div>
      </div>

      {useCustomCache && (
        <div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor={cacheMinutesId}>
                {tGlobal("refresh_interval_minutes_label")}
              </Label>
              <Input
                id={cacheMinutesId}
                type="number"
                value={cacheMinutes}
                onChange={(e) => setCacheMinutes(e.target.value)}
                min={0}
                max={59}
                disabled={!isOnline}
                className={cn(
                  isCacheInvalid &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={cacheHoursId}>
                {tGlobal("refresh_interval_hours_label")}
              </Label>
              <Input
                id={cacheHoursId}
                type="number"
                value={cacheHours}
                onChange={(e) => setCacheHours(e.target.value)}
                min={0}
                max={23}
                disabled={!isOnline}
                className={cn(
                  isCacheInvalid &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={cacheDaysId}>
                {tGlobal("refresh_interval_days_label")}
              </Label>
              <Input
                id={cacheDaysId}
                type="number"
                value={cacheDays}
                onChange={(e) => setCacheDays(e.target.value)}
                min={0}
                max={3650}
                disabled={!isOnline}
                className={cn(
                  isCacheInvalid &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>
          </div>
          {isCacheInvalid ? (
            <p className="mt-2 text-sm text-destructive">
              {tGlobal("cache_validation_error")}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("custom_cache_hint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

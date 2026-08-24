"use client";

import { useTranslations } from "next-intl";
import { CronTimeSelect } from "@/components/cron-time-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { SettingsFormController } from "@/components/use-settings-form-controller";
import {
  type CronPreset,
  cronPresetOptions,
  cronWeekdayOptions,
  defaultCronExpression,
} from "@/lib/settings/schedule-fields";
import { cn } from "@/lib/utils";
import type { ReleaseSelectionStrategy } from "@/types";
import { allPreReleaseTypes } from "@/types";

type GlobalAutomationMode = "interval" | "cron";

export function ReleaseAutomationSettingsSections({
  controller,
}: {
  controller: SettingsFormController;
}) {
  const t = useTranslations("SettingsForm");
  const {
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    channels,
    cronError,
    cronExpression,
    cronPreset,
    cronTime,
    cronWeekday,
    customPreReleaseMarkers,
    days,
    excludeRegex,
    excludeRegexError,
    handleChannelChange,
    handleDeselectAllPreRelease,
    handlePreReleaseSubChannelChange,
    handleSelectAllPreRelease,
    hours,
    ids,
    includeRegex,
    includeRegexError,
    intervalError,
    invalidCustomPreReleaseMarkers,
    isCacheInvalid,
    isOnline,
    isPreReleaseChecked,
    minutes,
    parallelRepoFetches,
    parallelRepoFetchesError,
    preReleaseSubChannels,
    releaseSelectionStrategy,
    releasesPerPage,
    releasesPerPageError,
    requestImmediateSave,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setCustomPreReleaseMarkers,
    setDays,
    setExcludeRegex,
    setHours,
    setIncludeRegex,
    setMinutes,
    setParallelRepoFetches,
    setReleaseSelectionStrategy,
    setReleasesPerPage,
    showParallelHighWarning,
    showParallelTokenWarning,
    timeFormat,
  } = controller;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("release_channel_title")}</CardTitle>
          <CardDescription>{t("release_channel_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-medium">{t("release_channel_types_title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("release_channel_description_global")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={ids.stable}
              checked={channels.includes("stable")}
              onCheckedChange={() => handleChannelChange("stable")}
              disabled={!isOnline}
            />
            <Label htmlFor={ids.stable} className="font-normal cursor-pointer">
              {t("release_channel_stable")}
            </Label>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={ids.prerelease}
                checked={isPreReleaseChecked}
                onCheckedChange={() => handleChannelChange("prerelease")}
                disabled={!isOnline}
              />
              <Label
                htmlFor={ids.prerelease}
                className="font-normal cursor-pointer"
              >
                {t("release_channel_prerelease")}
              </Label>
            </div>

            <div
              className={cn(
                "ms-6 ps-3 border-s-2 transition-all duration-300 ease-in-out overflow-hidden",
                isPreReleaseChecked
                  ? "mt-4 max-h-[600px] opacity-100"
                  : "max-h-0 opacity-0",
              )}
            >
              <div className="pb-2 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("prerelease_subtype_description")}
                </p>
                <div className="flex gap-2 mb-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAllPreRelease}
                    disabled={!isPreReleaseChecked || !isOnline}
                  >
                    {t("prerelease_select_all")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDeselectAllPreRelease}
                    disabled={!isPreReleaseChecked || !isOnline}
                  >
                    {t("prerelease_deselect_all")}
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
                  {allPreReleaseTypes.map((subType) => (
                    <div key={subType} className="flex items-center gap-2">
                      <Checkbox
                        id={`prerelease-${subType}`}
                        checked={preReleaseSubChannels.includes(subType)}
                        onCheckedChange={() =>
                          handlePreReleaseSubChannelChange(subType)
                        }
                        disabled={!isPreReleaseChecked || !isOnline}
                      />
                      <Label
                        htmlFor={`prerelease-${subType}`}
                        className="font-normal cursor-pointer text-sm"
                      >
                        {subType}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 ms-6 ps-3 border-s-2">
            <Label htmlFor={ids.customPreReleaseMarkers}>
              {t("custom_prerelease_markers_label")}
            </Label>
            <Input
              id={ids.customPreReleaseMarkers}
              dir="auto"
              value={customPreReleaseMarkers}
              onChange={(event) =>
                setCustomPreReleaseMarkers(event.target.value)
              }
              placeholder={t("custom_prerelease_markers_placeholder")}
              disabled={!isOnline}
              aria-invalid={invalidCustomPreReleaseMarkers.length > 0}
              className={cn(
                invalidCustomPreReleaseMarkers.length > 0 &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {invalidCustomPreReleaseMarkers.length > 0 ? (
              <p className="text-sm text-destructive">
                {t("custom_prerelease_markers_error_invalid")}{" "}
                {invalidCustomPreReleaseMarkers.join(", ")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("custom_prerelease_markers_description")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={ids.draft}
              checked={channels.includes("draft")}
              onCheckedChange={() => handleChannelChange("draft")}
              disabled={!isOnline}
            />
            <Label htmlFor={ids.draft} className="font-normal cursor-pointer">
              {t("release_channel_draft")}
            </Label>
          </div>

          <div className="space-y-2 pt-4">
            <h3 className="font-medium">{t("regex_filter_title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("regex_filter_description")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.includeRegex}>{t("include_regex_label")}</Label>
            <Input
              id={ids.includeRegex}
              dir="ltr"
              value={includeRegex}
              onChange={(e) => setIncludeRegex(e.target.value)}
              placeholder={t("regex_placeholder")}
              disabled={!isOnline}
              className={cn(
                !!includeRegexError &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {includeRegexError && (
              <p className="text-sm text-destructive">
                {t("regex_error_invalid")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.excludeRegex}>{t("exclude_regex_label")}</Label>
            <Input
              id={ids.excludeRegex}
              dir="ltr"
              value={excludeRegex}
              onChange={(e) => setExcludeRegex(e.target.value)}
              placeholder={t("regex_placeholder")}
              disabled={!isOnline}
              className={cn(
                !!excludeRegexError &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {excludeRegexError && (
              <p className="text-sm text-destructive">
                {t("regex_error_invalid")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="break-words">
            {t("automation_settings_title")}
          </CardTitle>
          <CardDescription>
            {t("automation_settings_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor={ids.automationMode}>
              {t("automation_mode_label")}
            </Label>
            <Select
              value={automationMode}
              onValueChange={(value: GlobalAutomationMode) => {
                requestImmediateSave();
                setAutomationMode(value);
              }}
              disabled={!isOnline}
            >
              <SelectTrigger id={ids.automationMode} className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">
                  {t("automation_mode_interval")}
                </SelectItem>
                <SelectItem value="cron">
                  {t("automation_mode_cron")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {automationMode === "interval" && (
            <div>
              <Label>{t("refresh_interval_title")}</Label>
              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor={ids.intervalMinutes}>
                    {t("refresh_interval_minutes_label")}
                  </Label>
                  <Input
                    id={ids.intervalMinutes}
                    type="number"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
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
                  <Label htmlFor={ids.intervalHours}>
                    {t("refresh_interval_hours_label")}
                  </Label>
                  <Input
                    id={ids.intervalHours}
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
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
                  <Label htmlFor={ids.intervalDays}>
                    {t("refresh_interval_days_label")}
                  </Label>
                  <Input
                    id={ids.intervalDays}
                    type="number"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
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
                  {t("refresh_interval_error_min")}
                </p>
              ) : intervalError === "too_high" ? (
                <p className="mt-2 text-sm text-destructive">
                  {t("refresh_interval_error_max")}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("refresh_interval_hint")}
                </p>
              )}
            </div>
          )}

          {automationMode === "cron" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor={ids.cronPreset}>{t("cron_preset_label")}</Label>
                <Select
                  value={cronPreset}
                  onValueChange={(value: CronPreset) => {
                    requestImmediateSave();
                    setCronPreset(value);
                  }}
                  disabled={!isOnline}
                >
                  <SelectTrigger id={ids.cronPreset} className="mt-2">
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

              {cronPreset !== "custom" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{t("cron_time_label")}</Label>
                    <CronTimeSelect
                      ids={{
                        hour: ids.cronHour,
                        minute: ids.cronMinute,
                        period: ids.cronPeriod,
                      }}
                      labels={{
                        hour: t("cron_time_hour_label"),
                        minute: t("cron_time_minute_label"),
                        period: t("cron_time_period_label"),
                        am: t("cron_time_am"),
                        pm: t("cron_time_pm"),
                      }}
                      value={cronTime}
                      onChange={(value) => {
                        requestImmediateSave();
                        setCronTime(value);
                      }}
                      timeFormat={timeFormat}
                      disabled={!isOnline}
                    />
                  </div>
                  {cronPreset === "weekly" && (
                    <div className="space-y-2">
                      <Label htmlFor={ids.cronWeekday}>
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
                        <SelectTrigger id={ids.cronWeekday}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {cronWeekdayOptions.map((weekday) => (
                            <SelectItem
                              key={weekday.value}
                              value={weekday.value}
                            >
                              {t(weekday.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor={ids.cronExpression}>
                    {t("cron_expression_label")}
                  </Label>
                  <Input
                    id={ids.cronExpression}
                    dir="ltr"
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
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
                <p className="text-xs text-muted-foreground">
                  {t("cron_hint")}
                </p>
              )}
            </div>
          )}

          <div>
            <Label>{t("cache_settings_title")}</Label>
            <div className="grid grid-cols-3 gap-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor={ids.cacheMinutes}>
                  {t("refresh_interval_minutes_label")}
                </Label>
                <Input
                  id={ids.cacheMinutes}
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
                <Label htmlFor={ids.cacheHours}>
                  {t("refresh_interval_hours_label")}
                </Label>
                <Input
                  id={ids.cacheHours}
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
                <Label htmlFor={ids.cacheDays}>
                  {t("refresh_interval_days_label")}
                </Label>
                <Input
                  id={ids.cacheDays}
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
                {t("cache_validation_error")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("cache_settings_description")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={ids.releaseSelectionStrategy}>
              {t("release_selection_strategy_label")}
            </Label>
            <Select
              value={releaseSelectionStrategy}
              onValueChange={(value: ReleaseSelectionStrategy) =>
                setReleaseSelectionStrategy(value)
              }
              disabled={!isOnline}
            >
              <SelectTrigger
                id={ids.releaseSelectionStrategy}
                className="w-full sm:w-[320px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">
                  {t("release_selection_newest")}
                </SelectItem>
                <SelectItem value="provider_latest">
                  {t("release_selection_provider_latest")}
                </SelectItem>
                <SelectItem value="highest_version">
                  {t("release_selection_highest_version")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`release_selection_${releaseSelectionStrategy}_hint`)}
            </p>
          </div>

          <div>
            <Label htmlFor={ids.releasesPerPage}>
              {t("releases_per_page_label")}
            </Label>
            <Input
              id={ids.releasesPerPage}
              type="number"
              value={releasesPerPage}
              onChange={(e) => setReleasesPerPage(e.target.value)}
              min={1}
              max={1000}
              step={1}
              disabled={!isOnline}
              className={cn(
                "mt-2 w-full sm:w-48",
                !!releasesPerPageError &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {releasesPerPageError === "invalid" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("integer_error_invalid")}
              </p>
            ) : releasesPerPageError === "too_low" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("releases_per_page_error_min")}
              </p>
            ) : releasesPerPageError === "too_high" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("releases_per_page_error_max_1000")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("releases_per_page_hint_1000")}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {t("releases_per_page_api_call_hint")}
            </p>
          </div>

          <div>
            <Label htmlFor={ids.parallelRepoFetches}>
              {t("parallel_repo_fetches_label")}
            </Label>
            <Input
              id={ids.parallelRepoFetches}
              type="number"
              value={parallelRepoFetches}
              onChange={(e) => setParallelRepoFetches(e.target.value)}
              min={1}
              max={50}
              step={1}
              disabled={!isOnline}
              className={cn(
                "mt-2 w-full sm:w-48",
                !!parallelRepoFetchesError &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {parallelRepoFetchesError === "invalid" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("integer_error_invalid")}
              </p>
            ) : parallelRepoFetchesError === "too_low" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("parallel_repo_fetches_error_min")}
              </p>
            ) : parallelRepoFetchesError === "too_high" ? (
              <p className="mt-2 text-sm text-destructive">
                {t("parallel_repo_fetches_error_max")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("parallel_repo_fetches_hint")}
              </p>
            )}
            {showParallelTokenWarning && (
              <p className="mt-2 text-xs text-yellow-600">
                {t("parallel_repo_fetches_warning_token")}
              </p>
            )}
            {showParallelHighWarning && (
              <p className="mt-2 text-xs text-yellow-600">
                {t("parallel_repo_fetches_warning_high")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

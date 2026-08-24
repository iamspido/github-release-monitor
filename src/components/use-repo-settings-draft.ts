"use client";

import * as React from "react";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import {
  isCacheIntervalInvalid,
  parseCustomPreReleaseMarkers,
  type RangeValidationError,
  validateCronInput,
  validateCustomPreReleaseMarkersInput,
  validateFilledInterval,
  validateOptionalIntegerInput,
  validateRegexInput,
} from "@/lib/settings/form-model";
import {
  buildCronExpression,
  type CronPreset,
  inferCronParts,
  MAX_INTERVAL_MINUTES,
  MINUTES_IN_DAY,
  MINUTES_IN_HOUR,
  minutesToDhms,
} from "@/lib/settings/schedule-fields";
import type {
  AppriseFormat,
  AppSettings,
  PreReleaseChannelType,
  ReleaseChannel,
  ReleaseSelectionStrategy,
  Repository,
} from "@/types";
import { allPreReleaseTypes } from "@/types";

type IntervalValidationError = RangeValidationError;
export type RepoAutomationMode = "global" | "interval" | "cron";

export type RepositorySettingsSnapshot = Pick<
  Repository,
  | "displayName"
  | "isPinned"
  | "tags"
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "customPreReleaseMarkers"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
  | "releasesPerPage"
  | "refreshInterval"
  | "cacheInterval"
  | "backgroundCheckCron"
  | "includeRegex"
  | "excludeRegex"
  | "appriseTags"
  | "appriseFormat"
>;

export type RepositorySettingsSource = Pick<
  Repository,
  | "displayName"
  | "isPinned"
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "customPreReleaseMarkers"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
  | "releasesPerPage"
  | "refreshInterval"
  | "cacheInterval"
  | "backgroundCheckCron"
  | "includeRegex"
  | "excludeRegex"
  | "appriseTags"
  | "appriseFormat"
>;

export function getRepoAutomationMode(
  repository?: Pick<Repository, "refreshInterval" | "backgroundCheckCron">,
): RepoAutomationMode {
  if (repository?.backgroundCheckCron) return "cron";
  return typeof repository?.refreshInterval === "number"
    ? "interval"
    : "global";
}

interface RepoSettingsDraftOptions {
  currentRepoSettings?: RepositorySettingsSource;
  globalSettings: AppSettings;
  repositoryTags: string[];
}

export function useRepoSettingsDraft({
  currentRepoSettings,
  globalSettings,
  repositoryTags,
}: RepoSettingsDraftOptions) {
  const baseId = React.useId();
  const ids = React.useMemo(
    () => ({
      stable: `${baseId}-stable`,
      displayName: `${baseId}-display-name`,
      isPinned: `${baseId}-is-pinned`,
      repositoryTags: `${baseId}-repository-tags`,
      prerelease: `${baseId}-prerelease`,
      draft: `${baseId}-draft`,
      includeRegex: `${baseId}-include-regex`,
      excludeRegex: `${baseId}-exclude-regex`,
      releasesPerPage: `${baseId}-releases-per-page`,
      releaseSelectionStrategy: `${baseId}-release-selection-strategy`,
      versionTagPattern: `${baseId}-version-tag-pattern`,
      refreshMode: `${baseId}-refresh-mode`,
      intervalMinutes: `${baseId}-interval-minutes`,
      intervalHours: `${baseId}-interval-hours`,
      intervalDays: `${baseId}-interval-days`,
      cacheOverride: `${baseId}-cache-override`,
      cacheMinutes: `${baseId}-cache-minutes`,
      cacheHours: `${baseId}-cache-hours`,
      cacheDays: `${baseId}-cache-days`,
      cronPreset: `${baseId}-cron-preset`,
      cronHour: `${baseId}-cron-hour`,
      cronMinute: `${baseId}-cron-minute`,
      cronPeriod: `${baseId}-cron-period`,
      cronWeekday: `${baseId}-cron-weekday`,
      cronExpression: `${baseId}-cron-expression`,
      appriseFormat: `${baseId}-apprise-format`,
      appriseTags: `${baseId}-apprise-tags`,
      prereleaseSubChannelBase: `${baseId}-prerelease-sub-channel`,
      customPreReleaseMarkers: `${baseId}-custom-prerelease-markers`,
      useGlobalCustomPreReleaseMarkers: `${baseId}-use-global-custom-prerelease-markers`,
    }),
    [baseId],
  );

  const [channels, setChannels] = React.useState<ReleaseChannel[]>(
    currentRepoSettings?.releaseChannels ?? [],
  );
  const [displayName, setDisplayName] = React.useState(
    currentRepoSettings?.displayName ?? "",
  );
  const [isPinned, setIsPinned] = React.useState(
    currentRepoSettings?.isPinned === true,
  );
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<
    PreReleaseChannelType[] | undefined
  >(currentRepoSettings?.preReleaseSubChannels);
  const [customPreReleaseMarkers, setCustomPreReleaseMarkers] = React.useState(
    (currentRepoSettings?.customPreReleaseMarkers ?? []).join(", "),
  );
  const [
    useGlobalCustomPreReleaseMarkers,
    setUseGlobalCustomPreReleaseMarkers,
  ] = React.useState(
    currentRepoSettings?.customPreReleaseMarkers === undefined,
  );
  const [releaseSelectionStrategy, setReleaseSelectionStrategy] =
    React.useState<ReleaseSelectionStrategy | undefined>(
      currentRepoSettings?.releaseSelectionStrategy,
    );
  const [versionTagPattern, setVersionTagPattern] = React.useState(
    currentRepoSettings?.versionTagPattern ?? "",
  );
  const [releasesPerPage, setReleasesPerPage] = React.useState<string | number>(
    currentRepoSettings?.releasesPerPage ?? "",
  );
  const [automationMode, setAutomationMode] =
    React.useState<RepoAutomationMode>(
      getRepoAutomationMode(currentRepoSettings),
    );
  const initialInterval = minutesToDhms(
    currentRepoSettings?.refreshInterval ?? 60,
  );
  const [intervalDays, setIntervalDays] = React.useState(
    String(initialInterval.d),
  );
  const [intervalHours, setIntervalHours] = React.useState(
    String(initialInterval.h),
  );
  const [intervalMinutes, setIntervalMinutes] = React.useState(
    String(initialInterval.m),
  );
  const [useCustomCache, setUseCustomCache] = React.useState(
    typeof currentRepoSettings?.cacheInterval === "number",
  );
  const initialCache = minutesToDhms(currentRepoSettings?.cacheInterval ?? 0);
  const [cacheDays, setCacheDays] = React.useState(String(initialCache.d));
  const [cacheHours, setCacheHours] = React.useState(String(initialCache.h));
  const [cacheMinutes, setCacheMinutes] = React.useState(
    String(initialCache.m),
  );
  const initialCron = React.useMemo(
    () => inferCronParts(currentRepoSettings?.backgroundCheckCron ?? undefined),
    [currentRepoSettings?.backgroundCheckCron],
  );
  const [cronPreset, setCronPreset] = React.useState<CronPreset>(
    initialCron.preset,
  );
  const [cronTime, setCronTime] = React.useState(initialCron.time);
  const [cronWeekday, setCronWeekday] = React.useState(initialCron.weekday);
  const [cronExpression, setCronExpression] = React.useState(
    initialCron.expression,
  );
  const [includeRegex, setIncludeRegex] = React.useState(
    currentRepoSettings?.includeRegex ?? "",
  );
  const [excludeRegex, setExcludeRegex] = React.useState(
    currentRepoSettings?.excludeRegex ?? "",
  );
  const [appriseTags, setAppriseTags] = React.useState(
    currentRepoSettings?.appriseTags ?? "",
  );
  const [appriseFormat, setAppriseFormat] = React.useState<AppriseFormat | "">(
    currentRepoSettings?.appriseFormat ?? "",
  );

  const useGlobalChannels = channels.length === 0;
  const useAutomaticDisplayName = displayName.trim() === "";
  const useGlobalSubChannels = preReleaseSubChannels === undefined;
  const useGlobalReleaseSelection = releaseSelectionStrategy === undefined;
  const effectiveReleaseSelectionStrategy =
    releaseSelectionStrategy ??
    globalSettings.releaseSelectionStrategy ??
    "newest";
  const useDefaultVersionTagPattern = versionTagPattern.trim() === "";
  const useGlobalReleasesPerPage = String(releasesPerPage).trim() === "";
  const useGlobalAutomation = automationMode === "global" && !useCustomCache;
  const useGlobalIncludeRegex = includeRegex.trim() === "";
  const useGlobalExcludeRegex = excludeRegex.trim() === "";
  const useGlobalAppriseTags = appriseTags.trim() === "";
  const useGlobalAppriseFormat = appriseFormat === "";

  const isUsingAllGlobalSettings =
    !isPinned &&
    useAutomaticDisplayName &&
    useGlobalChannels &&
    useGlobalSubChannels &&
    useGlobalCustomPreReleaseMarkers &&
    useGlobalReleaseSelection &&
    useDefaultVersionTagPattern &&
    useGlobalReleasesPerPage &&
    useGlobalAutomation &&
    useGlobalIncludeRegex &&
    useGlobalExcludeRegex &&
    useGlobalAppriseTags &&
    useGlobalAppriseFormat;

  const newSettings: RepositorySettingsSnapshot = React.useMemo(() => {
    const releasesPerPageValue = String(releasesPerPage).trim();
    const parsedReleasesPerPage = Number.parseInt(releasesPerPageValue, 10);
    const finalReleasesPerPage =
      releasesPerPageValue && !Number.isNaN(parsedReleasesPerPage)
        ? parsedReleasesPerPage
        : null;
    const finalRefreshInterval =
      automationMode === "interval"
        ? (Number.parseInt(intervalDays, 10) || 0) * MINUTES_IN_DAY +
          (Number.parseInt(intervalHours, 10) || 0) * MINUTES_IN_HOUR +
          (Number.parseInt(intervalMinutes, 10) || 0)
        : null;
    const finalCacheInterval = useCustomCache
      ? (Number.parseInt(cacheDays, 10) || 0) * MINUTES_IN_DAY +
        (Number.parseInt(cacheHours, 10) || 0) * MINUTES_IN_HOUR +
        (Number.parseInt(cacheMinutes, 10) || 0)
      : null;
    const finalCron =
      automationMode === "cron"
        ? buildCronExpression(cronPreset, cronTime, cronWeekday, cronExpression)
        : undefined;

    return {
      displayName: displayName.trim() || undefined,
      isPinned,
      tags: repositoryTags,
      releaseChannels: channels,
      preReleaseSubChannels,
      customPreReleaseMarkers: useGlobalCustomPreReleaseMarkers
        ? undefined
        : parseCustomPreReleaseMarkers(customPreReleaseMarkers),
      releaseSelectionStrategy,
      versionTagPattern: versionTagPattern.trim() || undefined,
      releasesPerPage: finalReleasesPerPage,
      refreshInterval: finalRefreshInterval,
      cacheInterval: finalCacheInterval,
      backgroundCheckCron: finalCron || undefined,
      includeRegex: includeRegex.trim() || undefined,
      excludeRegex: excludeRegex.trim() || undefined,
      appriseTags: appriseTags.trim() || undefined,
      appriseFormat: appriseFormat || undefined,
    };
  }, [
    appriseFormat,
    appriseTags,
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    channels,
    cronExpression,
    cronPreset,
    cronTime,
    cronWeekday,
    customPreReleaseMarkers,
    displayName,
    excludeRegex,
    includeRegex,
    intervalDays,
    intervalHours,
    intervalMinutes,
    isPinned,
    preReleaseSubChannels,
    releaseSelectionStrategy,
    releasesPerPage,
    repositoryTags,
    useCustomCache,
    useGlobalCustomPreReleaseMarkers,
    versionTagPattern,
  ]);

  const validation = React.useMemo(() => {
    const intervalFieldsFilled =
      intervalDays !== "" && intervalHours !== "" && intervalMinutes !== "";
    const intervalError: IntervalValidationError =
      automationMode === "interval"
        ? validateFilledInterval(
            newSettings.refreshInterval ?? 0,
            intervalFieldsFilled,
            MAX_INTERVAL_MINUTES,
          )
        : null;
    const cacheFieldsFilled =
      cacheDays !== "" && cacheHours !== "" && cacheMinutes !== "";
    const effectiveAutomationUsesInterval =
      automationMode === "interval" ||
      (automationMode === "global" && !globalSettings.backgroundCheckCron);
    const effectiveRefreshInterval =
      automationMode === "interval"
        ? (newSettings.refreshInterval ?? 0)
        : globalSettings.refreshInterval;

    return {
      releasesPerPageError: validateOptionalIntegerInput(
        releasesPerPage,
        1,
        1000,
      ),
      intervalError,
      isCacheInvalid: isCacheIntervalInvalid({
        enabled: effectiveAutomationUsesInterval && useCustomCache,
        fieldsFilled: cacheFieldsFilled,
        cacheInterval: newSettings.cacheInterval ?? 0,
        refreshInterval: effectiveRefreshInterval,
      }),
      cronError: validateCronInput(
        newSettings.backgroundCheckCron,
        automationMode === "cron",
      ),
      includeRegexError: validateRegexInput(includeRegex),
      excludeRegexError: validateRegexInput(excludeRegex),
      versionTagPatternError: validateVersionTagPattern(versionTagPattern),
      invalidCustomPreReleaseMarkers: useGlobalCustomPreReleaseMarkers
        ? []
        : validateCustomPreReleaseMarkersInput(customPreReleaseMarkers),
    };
  }, [
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    customPreReleaseMarkers,
    excludeRegex,
    globalSettings.backgroundCheckCron,
    globalSettings.refreshInterval,
    includeRegex,
    intervalDays,
    intervalHours,
    intervalMinutes,
    newSettings.backgroundCheckCron,
    newSettings.cacheInterval,
    newSettings.refreshInterval,
    releasesPerPage,
    useCustomCache,
    useGlobalCustomPreReleaseMarkers,
    versionTagPattern,
  ]);

  const hasEmptyIntervalFields =
    automationMode === "interval" &&
    [intervalDays, intervalHours, intervalMinutes].some(
      (value) => value === "",
    );
  const hasEmptyCacheFields =
    useCustomCache &&
    [cacheDays, cacheHours, cacheMinutes].some((value) => value === "");
  const hasDisplayNameError =
    !normalizeRepositoryDisplayName(displayName).success;

  const hydrate = React.useCallback((settings: RepositorySettingsSnapshot) => {
    setChannels(settings.releaseChannels ?? []);
    setDisplayName(settings.displayName ?? "");
    setIsPinned(settings.isPinned === true);
    setPreReleaseSubChannels(settings.preReleaseSubChannels);
    setCustomPreReleaseMarkers(
      (settings.customPreReleaseMarkers ?? []).join(", "),
    );
    setUseGlobalCustomPreReleaseMarkers(
      settings.customPreReleaseMarkers === undefined,
    );
    setReleaseSelectionStrategy(settings.releaseSelectionStrategy);
    setVersionTagPattern(settings.versionTagPattern ?? "");
    setReleasesPerPage(settings.releasesPerPage ?? "");
    setAutomationMode(getRepoAutomationMode(settings));
    const interval = minutesToDhms(settings.refreshInterval ?? 60);
    setIntervalDays(String(interval.d));
    setIntervalHours(String(interval.h));
    setIntervalMinutes(String(interval.m));
    setUseCustomCache(typeof settings.cacheInterval === "number");
    const cache = minutesToDhms(settings.cacheInterval ?? 0);
    setCacheDays(String(cache.d));
    setCacheHours(String(cache.h));
    setCacheMinutes(String(cache.m));
    const cron = inferCronParts(settings.backgroundCheckCron ?? undefined);
    setCronPreset(cron.preset);
    setCronTime(cron.time);
    setCronWeekday(cron.weekday);
    setCronExpression(cron.expression);
    setIncludeRegex(settings.includeRegex ?? "");
    setExcludeRegex(settings.excludeRegex ?? "");
    setAppriseTags(settings.appriseTags ?? "");
    setAppriseFormat(settings.appriseFormat ?? "");
  }, []);

  const resetAutomation = React.useCallback(() => {
    const interval = minutesToDhms(globalSettings.refreshInterval);
    const cache = minutesToDhms(globalSettings.cacheInterval);
    setAutomationMode("global");
    setIntervalDays(String(interval.d));
    setIntervalHours(String(interval.h));
    setIntervalMinutes(String(interval.m));
    setUseCustomCache(false);
    setCacheDays(String(cache.d));
    setCacheHours(String(cache.h));
    setCacheMinutes(String(cache.m));
    setCronPreset("daily");
    setCronTime("08:00");
    setCronWeekday("1");
    setCronExpression("");
  }, [globalSettings.cacheInterval, globalSettings.refreshInterval]);

  const isStableChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes("stable")
    : channels.includes("stable");
  const isPreReleaseChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes("prerelease")
    : channels.includes("prerelease");
  const isDraftChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes("draft")
    : channels.includes("draft");
  const effectivePreReleaseSubChannels = useGlobalSubChannels
    ? globalSettings.preReleaseSubChannels || allPreReleaseTypes
    : preReleaseSubChannels || [];

  return {
    ...validation,
    appriseFormat,
    appriseTags,
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    channels,
    cronExpression,
    cronPreset,
    cronTime,
    cronWeekday,
    customPreReleaseMarkers,
    displayName,
    effectivePreReleaseSubChannels,
    effectiveReleaseSelectionStrategy,
    excludeRegex,
    hasDisplayNameError,
    hasEmptyCacheFields,
    hasEmptyIntervalFields,
    hydrate,
    ids,
    includeRegex,
    intervalDays,
    intervalHours,
    intervalMinutes,
    isDraftChecked,
    isPinned,
    isPreReleaseChecked,
    isStableChecked,
    isUsingAllGlobalSettings,
    newSettings,
    preReleaseSubChannels,
    releaseSelectionStrategy,
    releasesPerPage,
    resetAutomation,
    setAppriseFormat,
    setAppriseTags,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setChannels,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setCustomPreReleaseMarkers,
    setDisplayName,
    setExcludeRegex,
    setIncludeRegex,
    setIntervalDays,
    setIntervalHours,
    setIntervalMinutes,
    setIsPinned,
    setPreReleaseSubChannels,
    setReleaseSelectionStrategy,
    setReleasesPerPage,
    setUseCustomCache,
    setUseGlobalCustomPreReleaseMarkers,
    setVersionTagPattern,
    useCustomCache,
    useDefaultVersionTagPattern,
    useGlobalAppriseFormat,
    useGlobalAppriseTags,
    useGlobalChannels,
    useGlobalCustomPreReleaseMarkers,
    useGlobalReleaseSelection,
    useGlobalReleasesPerPage,
    useGlobalSubChannels,
    versionTagPattern,
  };
}

export type RepoSettingsDraft = ReturnType<typeof useRepoSettingsDraft>;

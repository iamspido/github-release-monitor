"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { updateSettingsPatchAction } from "@/app/settings/actions";
import {
  type AutosaveTask,
  useAutosaveController,
} from "@/hooks/use-autosave-controller";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  defaultSecurityHighlightCustomColor,
  getInvalidCustomSecurityPattern,
  isValidSecurityHighlightCustomColor,
  normalizeSecurityHighlightColorPreset,
  normalizeSecurityHighlightCustomColor,
} from "@/lib/security-release";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import {
  areSettingsSnapshotsEqual,
  getSettingsReconciliationPatch,
  hasSettingsSnapshotDrift,
  type IntegerValidationError,
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
  shouldSelectAllPreReleaseSubChannels,
  togglePreReleaseSubChannel,
  toggleReleaseChannel,
} from "@/lib/settings/release-channel-fields";
import {
  buildCronExpression,
  type CronPreset,
  defaultCronExpression,
  inferCronParts,
  inferCronPresetValue,
  inferCronWeekday,
  MAX_INTERVAL_MINUTES,
  MINUTES_IN_DAY,
  MINUTES_IN_HOUR,
  minutesToDhms,
} from "@/lib/settings/schedule-fields";
import type {
  AppriseFormat,
  AppSettings,
  Locale,
  NotificationMode,
  PreReleaseChannelType,
  ReleaseChannel,
  ReleaseProviderSortKey,
  ReleaseSelectionStrategy,
  ReleaseSortOrder,
  SecurityHighlightColorPreset,
  TimeFormat,
} from "@/types";
import { allPreReleaseTypes, defaultProviderSortOrder } from "@/types";

type GlobalAutomationMode = "interval" | "cron";
type IntervalValidationError = RangeValidationError;
type ReleasesPerPageError = IntegerValidationError;
type ParallelRepoFetchError = IntegerValidationError;
type HexColorError = "invalid" | null;
type SecurityPatternsError = "invalid" | null;

const DEFERRED_GLOBAL_SETTING_KEYS = new Set<keyof AppSettings>([
  "refreshInterval",
  "cacheInterval",
  "releasesPerPage",
  "parallelRepoFetches",
  "backgroundCheckCron",
  "includeRegex",
  "excludeRegex",
  "customPreReleaseMarkers",
  "securityHighlightCustomColor",
  "customSecurityPatterns",
  "appriseMaxCharacters",
  "appriseTags",
  "notificationMaxMessagesPerRun",
  "notificationDeliveryConcurrency",
]);

interface SettingsFormControllerOptions {
  currentSettings: AppSettings;
  isGithubTokenSet: boolean;
}

export function useSettingsFormController({
  currentSettings,
  isGithubTokenSet,
}: SettingsFormControllerOptions) {
  const t = useTranslations("SettingsForm");
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();

  const baseId = React.useId();

  const ids = React.useMemo(
    () => ({
      timeFormat12h: `${baseId}-time-12h`,
      timeFormat24h: `${baseId}-time-24h`,
      languageSelect: `${baseId}-language`,
      releaseSortOrder: `${baseId}-release-sort-order`,
      releaseSelectionStrategy: `${baseId}-release-selection-strategy`,
      providerSortOrder: `${baseId}-provider-sort-order`,
      prioritizeNewSecurityReleases: `${baseId}-prioritize-new-security-releases`,
      securityHighlightColor: `${baseId}-security-highlight-color`,
      securityHighlightCustomColor: `${baseId}-security-highlight-custom-color`,
      securityHighlightCustomColorPicker: `${baseId}-security-highlight-custom-color-picker`,
      confirmSecurityAcknowledge: `${baseId}-confirm-security-acknowledge`,
      includeDefaultSecurityPatterns: `${baseId}-include-default-security-patterns`,
      customSecurityPatterns: `${baseId}-custom-security-patterns`,
      showAcknowledge: `${baseId}-show-acknowledge`,
      showMarkAsNew: `${baseId}-show-mark-new`,
      showProviderPrefixInRepoId: `${baseId}-show-provider-prefix-in-repo-id`,
      showProviderDomainInRepoId: `${baseId}-show-provider-domain-in-repo-id`,
      repositoryFormExpanded: `${baseId}-repository-form-expanded`,
      stable: `${baseId}-stable`,
      prerelease: `${baseId}-prerelease`,
      draft: `${baseId}-draft`,
      customPreReleaseMarkers: `${baseId}-custom-prerelease-markers`,
      includeRegex: `${baseId}-include-regex`,
      excludeRegex: `${baseId}-exclude-regex`,
      intervalMinutes: `${baseId}-interval-minutes`,
      intervalHours: `${baseId}-interval-hours`,
      intervalDays: `${baseId}-interval-days`,
      automationMode: `${baseId}-automation-mode`,
      cronPreset: `${baseId}-cron-preset`,
      cronHour: `${baseId}-cron-hour`,
      cronMinute: `${baseId}-cron-minute`,
      cronPeriod: `${baseId}-cron-period`,
      cronWeekday: `${baseId}-cron-weekday`,
      cronExpression: `${baseId}-cron-expression`,
      cacheMinutes: `${baseId}-cache-minutes`,
      cacheHours: `${baseId}-cache-hours`,
      cacheDays: `${baseId}-cache-days`,
      releasesPerPage: `${baseId}-releases-per-page`,
      parallelRepoFetches: `${baseId}-parallel-fetches`,
      emailIncludeReleaseNotes: `${baseId}-email-include-release-notes`,
      emailNotificationMode: `${baseId}-email-notification-mode`,
      appriseIncludeReleaseNotes: `${baseId}-apprise-include-release-notes`,
      appriseNotificationMode: `${baseId}-apprise-notification-mode`,
      notificationMaxMessagesPerRun: `${baseId}-notification-max-messages-per-run`,
      notificationDeliveryConcurrency: `${baseId}-notification-delivery-concurrency`,
      appriseMaxChars: `${baseId}-apprise-chars`,
      appriseFormat: `${baseId}-apprise-format`,
      appriseTags: `${baseId}-apprise-tags`,
    }),
    [baseId],
  );

  const [timeFormat, setTimeFormat] = React.useState<TimeFormat>(
    currentSettings.timeFormat,
  );
  const [locale, setLocale] = React.useState<Locale>(currentSettings.locale);
  const [releaseSortOrder, setReleaseSortOrder] =
    React.useState<ReleaseSortOrder>(
      currentSettings.releaseSortOrder ?? "latest_first",
    );
  const [releaseSelectionStrategy, setReleaseSelectionStrategy] =
    React.useState<ReleaseSelectionStrategy>(
      currentSettings.releaseSelectionStrategy ?? "newest",
    );
  const [providerSortOrder, setProviderSortOrder] = React.useState<
    ReleaseProviderSortKey[]
  >(currentSettings.providerSortOrder ?? defaultProviderSortOrder);
  const [prioritizeNewSecurityReleases, setPrioritizeNewSecurityReleases] =
    React.useState<boolean>(
      currentSettings.prioritizeNewSecurityReleases ?? false,
    );
  const [securityHighlightColorPreset, setSecurityHighlightColorPreset] =
    React.useState<SecurityHighlightColorPreset>(
      normalizeSecurityHighlightColorPreset(
        currentSettings.securityHighlightColorPreset,
      ),
    );
  const [securityHighlightCustomColor, setSecurityHighlightCustomColor] =
    React.useState(
      normalizeSecurityHighlightCustomColor(
        currentSettings.securityHighlightCustomColor ??
          defaultSecurityHighlightCustomColor,
      ),
    );
  const [confirmSecurityAcknowledge, setConfirmSecurityAcknowledge] =
    React.useState<boolean>(
      currentSettings.confirmSecurityAcknowledge ?? false,
    );
  const [includeDefaultSecurityPatterns, setIncludeDefaultSecurityPatterns] =
    React.useState<boolean>(
      currentSettings.includeDefaultSecurityPatterns ?? true,
    );
  const [customSecurityPatterns, setCustomSecurityPatterns] = React.useState(
    currentSettings.customSecurityPatterns ?? "",
  );
  const [releasesPerPage, setReleasesPerPage] = React.useState(
    String(currentSettings.releasesPerPage || 30),
  );
  const [parallelRepoFetches, setParallelRepoFetches] = React.useState(
    String(currentSettings.parallelRepoFetches || 1),
  );
  const [channels, setChannels] = React.useState<ReleaseChannel[]>(
    currentSettings.releaseChannels || ["stable"],
  );
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<
    PreReleaseChannelType[]
  >(currentSettings.preReleaseSubChannels || allPreReleaseTypes);
  const [customPreReleaseMarkers, setCustomPreReleaseMarkers] = React.useState(
    (currentSettings.customPreReleaseMarkers ?? []).join(", "),
  );
  const [showAcknowledge, setShowAcknowledge] = React.useState<boolean>(
    currentSettings.showAcknowledge ?? true,
  );
  const [showMarkAsNew, setShowMarkAsNew] = React.useState<boolean>(
    currentSettings.showMarkAsNew ?? true,
  );
  const [showProviderPrefixInRepoId, setShowProviderPrefixInRepoId] =
    React.useState<boolean>(currentSettings.showProviderPrefixInRepoId ?? true);
  const [showProviderDomainInRepoId, setShowProviderDomainInRepoId] =
    React.useState<boolean>(currentSettings.showProviderDomainInRepoId ?? true);
  const [repositoryFormExpanded, setRepositoryFormExpanded] =
    React.useState<boolean>(currentSettings.repositoryFormExpanded ?? true);
  const [includeRegex, setIncludeRegex] = React.useState(
    currentSettings.includeRegex ?? "",
  );
  const [excludeRegex, setExcludeRegex] = React.useState(
    currentSettings.excludeRegex ?? "",
  );
  const [emailIncludeReleaseNotes, setEmailIncludeReleaseNotes] =
    React.useState(currentSettings.emailIncludeReleaseNotes !== false);
  const [emailNotificationMode, setEmailNotificationMode] =
    React.useState<NotificationMode>(
      currentSettings.emailNotificationMode ?? "per_release",
    );
  const [appriseIncludeReleaseNotes, setAppriseIncludeReleaseNotes] =
    React.useState(currentSettings.appriseIncludeReleaseNotes !== false);
  const [appriseNotificationMode, setAppriseNotificationMode] =
    React.useState<NotificationMode>(
      currentSettings.appriseNotificationMode ?? "per_release",
    );
  const [notificationMaxMessagesPerRun, setNotificationMaxMessagesPerRun] =
    React.useState(String(currentSettings.notificationMaxMessagesPerRun ?? 20));
  const [notificationDeliveryConcurrency, setNotificationDeliveryConcurrency] =
    React.useState(
      String(currentSettings.notificationDeliveryConcurrency ?? 4),
    );
  const [appriseMaxCharacters, setAppriseMaxCharacters] = React.useState(
    String(currentSettings.appriseMaxCharacters ?? 1800),
  );
  const [appriseTags, setAppriseTags] = React.useState(
    currentSettings.appriseTags ?? "",
  );
  const [appriseFormat, setAppriseFormat] = React.useState<AppriseFormat>(
    currentSettings.appriseFormat ?? "text",
  );
  const [automationMode, setAutomationMode] =
    React.useState<GlobalAutomationMode>(
      currentSettings.backgroundCheckCron ? "cron" : "interval",
    );
  const [cronPreset, setCronPreset] = React.useState<CronPreset>(() =>
    inferCronPresetValue(currentSettings.backgroundCheckCron),
  );
  const [cronTime, setCronTime] = React.useState(
    () => inferCronParts(currentSettings.backgroundCheckCron).time,
  );
  const [cronWeekday, setCronWeekday] = React.useState(() =>
    inferCronWeekday(currentSettings.backgroundCheckCron),
  );
  const [cronExpression, setCronExpression] = React.useState(
    currentSettings.backgroundCheckCron ?? defaultCronExpression,
  );

  const [days, setDays] = React.useState(() =>
    String(minutesToDhms(currentSettings.refreshInterval).d),
  );
  const [hours, setHours] = React.useState(() =>
    String(minutesToDhms(currentSettings.refreshInterval).h),
  );
  const [minutes, setMinutes] = React.useState(() =>
    String(minutesToDhms(currentSettings.refreshInterval).m),
  );

  const [cacheDays, setCacheDays] = React.useState(() =>
    String(minutesToDhms(currentSettings.cacheInterval).d),
  );
  const [cacheHours, setCacheHours] = React.useState(() =>
    String(minutesToDhms(currentSettings.cacheInterval).h),
  );
  const [cacheMinutes, setCacheMinutes] = React.useState(() =>
    String(minutesToDhms(currentSettings.cacheInterval).m),
  );

  const {
    status: saveStatus,
    setStatus: setSaveStatus,
    discardPending: discardPendingAutosave,
    schedule: scheduleAutosave,
    saveNow: saveAutosaveNow,
    flush: flushAutosave,
    pause: pauseAutosave,
    resume: resumeAutosave,
  } = useAutosaveController();
  const isInitialMount = React.useRef(true);
  const previousDraftSettingsRef = React.useRef(currentSettings);
  const [immediateSaveRevision, requestImmediateSave] = React.useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const handledImmediateSaveRevisionRef = React.useRef(0);
  const pendingLocaleNavigationRef = React.useRef<Locale | null>(null);
  const lastSavedSettingsRef = React.useRef(currentSettings);
  const lastSubmittedSettingsRef = React.useRef(currentSettings);
  const queuedSettingsRef = React.useRef<AppSettings | null>(null);

  // Check for saved state after locale change
  React.useEffect(() => {
    const savedAfterLocaleChange = sessionStorage.getItem(
      "settingsSavedAfterLocaleChange",
    );
    if (savedAfterLocaleChange === "true") {
      sessionStorage.removeItem("settingsSavedAfterLocaleChange");
      setSaveStatus("success");
    }
  }, [setSaveStatus]);

  const newSettings: AppSettings = React.useMemo(() => {
    const d = parseInt(days, 10) || 0;
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    const totalMinutes = d * MINUTES_IN_DAY + h * MINUTES_IN_HOUR + m;

    const dCache = parseInt(cacheDays, 10) || 0;
    const hCache = parseInt(cacheHours, 10) || 0;
    const mCache = parseInt(cacheMinutes, 10) || 0;
    const totalCacheMinutes =
      dCache * MINUTES_IN_DAY + hCache * MINUTES_IN_HOUR + mCache;

    const parsedAppriseChars = parseInt(appriseMaxCharacters, 10);
    const parsedMaxMessages = Number(notificationMaxMessagesPerRun);
    const parsedDeliveryConcurrency = Number(notificationDeliveryConcurrency);
    const backgroundCheckCron =
      automationMode === "cron"
        ? buildCronExpression(cronPreset, cronTime, cronWeekday, cronExpression)
        : undefined;

    return {
      timeFormat,
      locale,
      refreshInterval: totalMinutes,
      cacheInterval: totalCacheMinutes,
      backgroundCheckCron,
      releasesPerPage: parseInt(releasesPerPage, 10) || 30,
      parallelRepoFetches:
        parseInt(parallelRepoFetches, 10) ||
        currentSettings.parallelRepoFetches ||
        1,
      releaseChannels: channels,
      preReleaseSubChannels,
      customPreReleaseMarkers: parseCustomPreReleaseMarkers(
        customPreReleaseMarkers,
      ),
      releaseSelectionStrategy,
      releaseSortOrder,
      providerSortOrder,
      prioritizeNewSecurityReleases,
      securityHighlightColorPreset,
      securityHighlightCustomColor,
      confirmSecurityAcknowledge,
      includeDefaultSecurityPatterns,
      customSecurityPatterns,
      showAcknowledge,
      showMarkAsNew,
      showProviderPrefixInRepoId,
      showProviderDomainInRepoId,
      repositoryFormExpanded,
      includeRegex: includeRegex,
      excludeRegex: excludeRegex,
      emailIncludeReleaseNotes,
      emailNotificationMode,
      appriseIncludeReleaseNotes,
      appriseNotificationMode,
      notificationMaxMessagesPerRun: Number.isInteger(parsedMaxMessages)
        ? parsedMaxMessages
        : 20,
      notificationDeliveryConcurrency: Number.isInteger(
        parsedDeliveryConcurrency,
      )
        ? parsedDeliveryConcurrency
        : 4,
      appriseMaxCharacters: Number.isNaN(parsedAppriseChars)
        ? 1800
        : parsedAppriseChars,
      appriseTags,
      appriseFormat,
    };
  }, [
    days,
    hours,
    minutes,
    cacheDays,
    cacheHours,
    cacheMinutes,
    automationMode,
    cronPreset,
    cronTime,
    cronWeekday,
    cronExpression,
    releasesPerPage,
    parallelRepoFetches,
    timeFormat,
    locale,
    channels,
    preReleaseSubChannels,
    customPreReleaseMarkers,
    releaseSelectionStrategy,
    releaseSortOrder,
    providerSortOrder,
    prioritizeNewSecurityReleases,
    securityHighlightColorPreset,
    securityHighlightCustomColor,
    confirmSecurityAcknowledge,
    includeDefaultSecurityPatterns,
    customSecurityPatterns,
    showAcknowledge,
    showMarkAsNew,
    showProviderPrefixInRepoId,
    showProviderDomainInRepoId,
    repositoryFormExpanded,
    includeRegex,
    excludeRegex,
    emailIncludeReleaseNotes,
    emailNotificationMode,
    appriseIncludeReleaseNotes,
    appriseNotificationMode,
    notificationMaxMessagesPerRun,
    notificationDeliveryConcurrency,
    appriseMaxCharacters,
    appriseTags,
    appriseFormat,
    currentSettings.parallelRepoFetches,
  ]);

  const {
    intervalError,
    releasesPerPageError,
    parallelRepoFetchesError,
    notificationMaxMessagesError,
    notificationDeliveryConcurrencyError,
    isCacheInvalid,
    includeRegexError,
    excludeRegexError,
    cronError,
    securityHighlightCustomColorError,
    customSecurityPatternsError,
    invalidCustomPreReleaseMarkers,
  } = React.useMemo(() => {
    const refreshFieldsFilled = days !== "" && hours !== "" && minutes !== "";
    const cacheFieldsFilled =
      cacheDays !== "" && cacheHours !== "" && cacheMinutes !== "";
    const releasesPerPageFilled = releasesPerPage !== "";
    const parallelRepoFetchesFilled = parallelRepoFetches !== "";
    const notificationMaxMessagesFilled = notificationMaxMessagesPerRun !== "";
    const notificationDeliveryConcurrencyFilled =
      notificationDeliveryConcurrency !== "";
    const nextIntervalError: IntervalValidationError =
      automationMode === "interval"
        ? validateFilledInterval(
            newSettings.refreshInterval,
            refreshFieldsFilled,
            MAX_INTERVAL_MINUTES,
          )
        : null;
    const nextCronError = validateCronInput(
      newSettings.backgroundCheckCron,
      automationMode === "cron",
    );
    const nextReleasesPerPageError: ReleasesPerPageError = releasesPerPageFilled
      ? validateOptionalIntegerInput(releasesPerPage, 1, 1000)
      : null;
    const nextParallelRepoFetchesError: ParallelRepoFetchError =
      parallelRepoFetchesFilled
        ? validateOptionalIntegerInput(parallelRepoFetches, 1, 50)
        : null;
    const nextSecurityColorError: HexColorError =
      securityHighlightColorPreset === "custom" &&
      !isValidSecurityHighlightCustomColor(securityHighlightCustomColor)
        ? "invalid"
        : null;
    const nextSecurityPatternsError: SecurityPatternsError =
      getInvalidCustomSecurityPattern(customSecurityPatterns)
        ? "invalid"
        : null;

    return {
      intervalError: nextIntervalError,
      releasesPerPageError: nextReleasesPerPageError,
      parallelRepoFetchesError: nextParallelRepoFetchesError,
      notificationMaxMessagesError: notificationMaxMessagesFilled
        ? validateOptionalIntegerInput(notificationMaxMessagesPerRun, 0, 10_000)
        : null,
      notificationDeliveryConcurrencyError:
        notificationDeliveryConcurrencyFilled
          ? validateOptionalIntegerInput(notificationDeliveryConcurrency, 1, 50)
          : null,
      includeRegexError: validateRegexInput(includeRegex),
      excludeRegexError: validateRegexInput(excludeRegex),
      cronError: nextCronError,
      securityHighlightCustomColorError: nextSecurityColorError,
      customSecurityPatternsError: nextSecurityPatternsError,
      invalidCustomPreReleaseMarkers: validateCustomPreReleaseMarkersInput(
        customPreReleaseMarkers,
      ),
      isCacheInvalid: isCacheIntervalInvalid({
        enabled: automationMode === "interval" && refreshFieldsFilled,
        fieldsFilled: cacheFieldsFilled,
        cacheInterval: newSettings.cacheInterval,
        refreshInterval: newSettings.refreshInterval,
      }),
    };
  }, [
    days,
    hours,
    minutes,
    cacheDays,
    cacheHours,
    cacheMinutes,
    releasesPerPage,
    parallelRepoFetches,
    notificationMaxMessagesPerRun,
    notificationDeliveryConcurrency,
    newSettings.refreshInterval,
    newSettings.cacheInterval,
    includeRegex,
    excludeRegex,
    securityHighlightColorPreset,
    securityHighlightCustomColor,
    customSecurityPatterns,
    customPreReleaseMarkers,
    automationMode,
    newSettings.backgroundCheckCron,
  ]);

  const hasEmptyIntervalFields =
    automationMode === "interval" &&
    [days, hours, minutes].some((value) => value === "");
  const hasEmptyCronFields =
    automationMode === "cron" &&
    (cronPreset === "custom"
      ? cronExpression.trim() === ""
      : cronTime.trim() === "" ||
        (cronPreset === "weekly" && cronWeekday.trim() === ""));
  const hasEmptyFields =
    hasEmptyIntervalFields ||
    hasEmptyCronFields ||
    [
      cacheDays,
      cacheHours,
      cacheMinutes,
      releasesPerPage,
      parallelRepoFetches,
      appriseMaxCharacters,
      notificationMaxMessagesPerRun,
      notificationDeliveryConcurrency,
    ].some((value) => value === "");
  const hasValidationErrors = Boolean(
    hasEmptyFields ||
      intervalError ||
      isCacheInvalid ||
      releasesPerPageError ||
      parallelRepoFetchesError ||
      notificationMaxMessagesError ||
      notificationDeliveryConcurrencyError ||
      includeRegexError ||
      excludeRegexError ||
      securityHighlightCustomColorError ||
      customSecurityPatternsError ||
      invalidCustomPreReleaseMarkers.length > 0 ||
      cronError,
  );

  const createSaveTask = React.useCallback(
    (settingsSnapshot: AppSettings): AutosaveTask =>
      async () => {
        try {
          if (
            queuedSettingsRef.current &&
            areSettingsSnapshotsEqual(
              queuedSettingsRef.current,
              settingsSnapshot,
            )
          ) {
            queuedSettingsRef.current = null;
          }
          const settingsPatch = getSettingsReconciliationPatch(
            lastSavedSettingsRef.current,
            lastSubmittedSettingsRef.current,
            settingsSnapshot,
          );
          lastSubmittedSettingsRef.current = settingsSnapshot;
          const result = await updateSettingsPatchAction(settingsPatch);

          if (!result.success) {
            toast({
              title: result.message.title,
              description: result.message.description,
              variant: "destructive",
            });
            return false;
          }

          lastSavedSettingsRef.current = settingsSnapshot;
          lastSubmittedSettingsRef.current = settingsSnapshot;
          pendingLocaleNavigationRef.current =
            settingsSnapshot.locale !== currentSettings.locale
              ? settingsSnapshot.locale
              : null;
          return true;
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) return true;
          toast({
            title: t("toast_error_title"),
            description: t("autosave_error"),
            variant: "destructive",
          });
          return false;
        }
      },
    [currentSettings.locale, t, toast],
  );

  React.useEffect(() => {
    if (!isOnline) {
      pauseAutosave();
      return;
    }
    resumeAutosave();
  }, [isOnline, pauseAutosave, resumeAutosave]);

  React.useEffect(() => {
    if (saveStatus !== "success") return;
    if (hasValidationErrors) {
      setSaveStatus("idle");
      return;
    }
    const targetLocale = pendingLocaleNavigationRef.current;
    if (targetLocale) {
      if (newSettings.locale !== targetLocale) {
        setSaveStatus("idle");
        return;
      }
      pendingLocaleNavigationRef.current = null;
      sessionStorage.setItem("settingsSavedAfterLocaleChange", "true");
      router.push(pathname, { locale: targetLocale });
      return;
    }
    const timer = window.setTimeout(() => setSaveStatus("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [
    hasValidationErrors,
    newSettings.locale,
    pathname,
    router,
    saveStatus,
    setSaveStatus,
  ]);

  // Auto-Save Effect
  React.useEffect(() => {
    const previousDraftSettings = previousDraftSettingsRef.current;
    previousDraftSettingsRef.current = newSettings;
    const saveImmediatelyRequested =
      handledImmediateSaveRevisionRef.current !== immediateSaveRevision;
    handledImmediateSaveRevisionRef.current = immediateSaveRevision;

    if (isInitialMount.current) {
      isInitialMount.current = false;
      lastSavedSettingsRef.current = newSettings;
      lastSubmittedSettingsRef.current = newSettings;
      queuedSettingsRef.current = null;
      return;
    }

    if (
      !hasSettingsSnapshotDrift(
        lastSavedSettingsRef.current,
        lastSubmittedSettingsRef.current,
        newSettings,
      )
    ) {
      if (
        queuedSettingsRef.current &&
        !areSettingsSnapshotsEqual(queuedSettingsRef.current, newSettings)
      ) {
        queuedSettingsRef.current = null;
        discardPendingAutosave("idle");
      }
      if (
        !hasValidationErrors &&
        pendingLocaleNavigationRef.current === newSettings.locale
      ) {
        setSaveStatus("success");
      }
      return;
    }

    if (hasValidationErrors) {
      queuedSettingsRef.current = null;
      discardPendingAutosave("idle");
      return;
    }

    if (
      queuedSettingsRef.current &&
      !areSettingsSnapshotsEqual(queuedSettingsRef.current, newSettings) &&
      areSettingsSnapshotsEqual(lastSubmittedSettingsRef.current, newSettings)
    ) {
      queuedSettingsRef.current = null;
      discardPendingAutosave("idle");
      return;
    }

    const changedKeys = (
      Object.keys(newSettings) as Array<keyof AppSettings>
    ).filter(
      (key) =>
        !areSettingsSnapshotsEqual(
          previousDraftSettings[key],
          newSettings[key],
        ),
    );
    const saveImmediately =
      saveImmediatelyRequested ||
      (changedKeys.length > 0 &&
        changedKeys.every((key) => !DEFERRED_GLOBAL_SETTING_KEYS.has(key)));
    const task = createSaveTask(newSettings);
    queuedSettingsRef.current = newSettings;
    if (saveImmediately) saveAutosaveNow(task);
    else scheduleAutosave(task);
  }, [
    newSettings,
    immediateSaveRevision,
    hasValidationErrors,
    discardPendingAutosave,
    createSaveTask,
    saveAutosaveNow,
    scheduleAutosave,
    setSaveStatus,
  ]);

  const handleAutosaveBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (
      !hasValidationErrors &&
      (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement)
    ) {
      flushAutosave();
    }
  };

  const handleAutosaveKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (
      !hasValidationErrors &&
      !event.defaultPrevented &&
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      event.target.type !== "color"
    ) {
      flushAutosave();
    }
  };

  const handleChannelChange = (channel: ReleaseChannel) => {
    const newChannels = toggleReleaseChannel(channels, channel);

    if (newChannels.length === 0) {
      toast({
        title: t("toast_error_title"),
        description: t("release_channel_error_at_least_one"),
        variant: "destructive",
      });
      return;
    }
    setChannels(newChannels);

    if (shouldSelectAllPreReleaseSubChannels(channel, newChannels)) {
      setPreReleaseSubChannels(allPreReleaseTypes);
    }
  };

  const handlePreReleaseSubChannelChange = (
    subChannel: PreReleaseChannelType,
  ) => {
    setPreReleaseSubChannels((prev) =>
      togglePreReleaseSubChannel(prev, subChannel),
    );
  };

  const handleSelectAllPreRelease = () => {
    setPreReleaseSubChannels(allPreReleaseTypes);
  };

  const handleDeselectAllPreRelease = () => {
    setPreReleaseSubChannels([]);
  };

  const parsedParallelRepoFetches = Number.parseInt(parallelRepoFetches, 10);
  const hasValidParallelValue = !Number.isNaN(parsedParallelRepoFetches);
  const showParallelHighWarning =
    !parallelRepoFetchesError &&
    hasValidParallelValue &&
    parsedParallelRepoFetches > 20;
  const showParallelTokenWarning =
    !parallelRepoFetchesError &&
    hasValidParallelValue &&
    parsedParallelRepoFetches > 1 &&
    !isGithubTokenSet;

  const isPreReleaseChecked = channels.includes("prerelease");

  return {
    appriseFormat,
    appriseIncludeReleaseNotes,
    appriseMaxCharacters,
    appriseNotificationMode,
    appriseTags,
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    channels,
    confirmSecurityAcknowledge,
    cronError,
    cronExpression,
    cronPreset,
    cronTime,
    cronWeekday,
    customPreReleaseMarkers,
    customSecurityPatterns,
    customSecurityPatternsError,
    days,
    emailIncludeReleaseNotes,
    emailNotificationMode,
    excludeRegex,
    excludeRegexError,
    handleAutosaveBlur,
    handleAutosaveKeyDown,
    handleChannelChange,
    handleDeselectAllPreRelease,
    handlePreReleaseSubChannelChange,
    handleSelectAllPreRelease,
    hours,
    ids,
    includeDefaultSecurityPatterns,
    includeRegex,
    includeRegexError,
    intervalError,
    invalidCustomPreReleaseMarkers,
    isCacheInvalid,
    isOnline,
    isPreReleaseChecked,
    locale,
    minutes,
    notificationDeliveryConcurrency,
    notificationDeliveryConcurrencyError,
    notificationMaxMessagesError,
    notificationMaxMessagesPerRun,
    parallelRepoFetches,
    parallelRepoFetchesError,
    preReleaseSubChannels,
    prioritizeNewSecurityReleases,
    providerSortOrder,
    releaseSelectionStrategy,
    releaseSortOrder,
    releasesPerPage,
    releasesPerPageError,
    repositoryFormExpanded,
    requestImmediateSave,
    saveStatus,
    securityHighlightColorPreset,
    securityHighlightCustomColor,
    securityHighlightCustomColorError,
    setAppriseFormat,
    setAppriseIncludeReleaseNotes,
    setAppriseMaxCharacters,
    setAppriseNotificationMode,
    setAppriseTags,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setConfirmSecurityAcknowledge,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setCustomPreReleaseMarkers,
    setCustomSecurityPatterns,
    setDays,
    setEmailIncludeReleaseNotes,
    setEmailNotificationMode,
    setExcludeRegex,
    setHours,
    setIncludeDefaultSecurityPatterns,
    setIncludeRegex,
    setLocale,
    setMinutes,
    setNotificationDeliveryConcurrency,
    setNotificationMaxMessagesPerRun,
    setParallelRepoFetches,
    setPrioritizeNewSecurityReleases,
    setProviderSortOrder,
    setReleaseSelectionStrategy,
    setReleaseSortOrder,
    setReleasesPerPage,
    setRepositoryFormExpanded,
    setSecurityHighlightColorPreset,
    setSecurityHighlightCustomColor,
    setShowAcknowledge,
    setShowMarkAsNew,
    setShowProviderDomainInRepoId,
    setShowProviderPrefixInRepoId,
    setTimeFormat,
    showAcknowledge,
    showMarkAsNew,
    showParallelHighWarning,
    showParallelTokenWarning,
    showProviderDomainInRepoId,
    showProviderPrefixInRepoId,
    timeFormat,
  };
}

export type SettingsFormController = ReturnType<
  typeof useSettingsFormController
>;

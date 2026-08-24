"use client";

import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Save,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import {
  deleteAllRepositoriesAction,
  updateSettingsPatchAction,
} from "@/app/settings/actions";
import { CronTimeSelect } from "@/components/cron-time-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type AutosaveStatus,
  type AutosaveTask,
  useAutosaveController,
} from "@/hooks/use-autosave-controller";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { localeDisplayMetadata } from "@/i18n/locale-display";
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
  cronPresetOptions,
  cronWeekdayOptions,
  defaultCronExpression,
  inferCronParts,
  inferCronPresetValue,
  inferCronWeekday,
  MAX_INTERVAL_MINUTES,
  MINUTES_IN_DAY,
  MINUTES_IN_HOUR,
  minutesToDhms,
} from "@/lib/settings/schedule-fields";
import { cn } from "@/lib/utils";
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
type ParallelRepoFetchError = IntegerValidationError;
type HexColorError = "invalid" | null;
type SecurityPatternsError = "invalid" | null;

const providerSortOrderOptions: ReleaseProviderSortKey[][] = [
  ["github", "gitlab", "codeberg"],
  ["github", "codeberg", "gitlab"],
  ["gitlab", "github", "codeberg"],
  ["gitlab", "codeberg", "github"],
  ["codeberg", "github", "gitlab"],
  ["codeberg", "gitlab", "github"],
];

const securityHighlightColorOptions = [
  {
    value: "yellow",
    labelKey: "security_highlight_color_yellow",
    swatchClassName: "bg-yellow-500",
  },
  {
    value: "red",
    labelKey: "security_highlight_color_red",
    swatchClassName: "bg-red-500",
  },
  {
    value: "orange",
    labelKey: "security_highlight_color_orange",
    swatchClassName: "bg-orange-500",
  },
  {
    value: "blue",
    labelKey: "security_highlight_color_blue",
    swatchClassName: "bg-blue-500",
  },
  {
    value: "purple",
    labelKey: "security_highlight_color_purple",
    swatchClassName: "bg-purple-500",
  },
  {
    value: "custom",
    labelKey: "security_highlight_color_custom",
    swatchClassName: "",
  },
] as const satisfies readonly {
  value: SecurityHighlightColorPreset;
  labelKey: string;
  swatchClassName: string;
}[];

function serializeProviderSortOrder(order: ReleaseProviderSortKey[]) {
  return order.join(",");
}

function deserializeProviderSortOrder(value: string): ReleaseProviderSortKey[] {
  const parts = value.split(",") as ReleaseProviderSortKey[];
  const selected = providerSortOrderOptions.find(
    (option) =>
      serializeProviderSortOrder(option) === serializeProviderSortOrder(parts),
  );
  return selected ?? defaultProviderSortOrder;
}

function FloatingSaveIndicator({ status }: { status: AutosaveStatus }) {
  const t = useTranslations("SettingsForm");

  if (status === "idle") {
    return null;
  }

  const messages: Record<
    AutosaveStatus,
    { text: React.ReactNode; icon: React.ReactNode; className: string }
  > = {
    idle: { text: "", icon: null, className: "" },
    waiting: {
      text: t("autosave_waiting"),
      icon: <Save className="size-4" />,
      className: "text-muted-foreground",
    },
    saving: {
      text: t("autosave_saving"),
      icon: <Loader2 className="size-4 animate-spin" />,
      className: "text-muted-foreground",
    },
    success: {
      text: t("autosave_success"),
      icon: <CheckCircle className="size-4" />,
      className: "text-green-500",
    },
    error: {
      text: t("autosave_error"),
      icon: <AlertCircle className="size-4" />,
      className: "text-destructive",
    },
    paused: {
      text: t("autosave_paused_offline"),
      icon: <WifiOff className="size-4" />,
      className: "text-yellow-500",
    },
  };

  const current = messages[status];

  return (
    <div
      data-status={status}
      data-testid="autosave-status"
      className={cn(
        "fixed bottom-6 end-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-background shadow-lg transition-all duration-300 ease-in-out",
        current.className,
      )}
    >
      {current.icon}
      <span className="text-sm font-medium">{current.text}</span>
    </div>
  );
}

interface SettingsFormProps {
  currentSettings: AppSettings;
  isAppriseConfigured: boolean;
  isGithubTokenSet: boolean;
  onTimeFormatChange?: (timeFormat: TimeFormat) => void;
}

export function SettingsForm({
  currentSettings,
  isAppriseConfigured,
  isGithubTokenSet,
  onTimeFormatChange,
}: SettingsFormProps) {
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

  return (
    <>
      <FloatingSaveIndicator status={saveStatus} />

      {/* Delegated handlers give every text-like field consistent blur/Enter saving. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: child form controls remain the interactive targets */}
      <div
        className="mx-auto max-w-2xl space-y-8"
        onBlur={handleAutosaveBlur}
        onKeyDown={handleAutosaveKeyDown}
      >
        <Card>
          <CardHeader>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{t("time_format_label")}</Label>
              <RadioGroup
                value={timeFormat}
                onValueChange={(value: TimeFormat) => {
                  setTimeFormat(value);
                  onTimeFormatChange?.(value);
                }}
                className="flex items-center gap-4"
                disabled={!isOnline}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="12h"
                    id={ids.timeFormat12h}
                    data-testid="time-format-12h"
                  />
                  <Label htmlFor={ids.timeFormat12h}>
                    {t("time_format_12h")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="24h"
                    id={ids.timeFormat24h}
                    data-testid="time-format-24h"
                  />
                  <Label htmlFor={ids.timeFormat24h}>
                    {t("time_format_24h")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.languageSelect}>{t("language_label")}</Label>
              <Select
                value={locale}
                onValueChange={(value: Locale) => setLocale(value)}
                disabled={!isOnline}
              >
                <SelectTrigger
                  id={ids.languageSelect}
                  data-testid="language-select"
                  className="w-full sm:w-[180px]"
                >
                  <SelectValue placeholder={t("language_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {localeDisplayMetadata.map(({ code, nativeName }) => (
                    <SelectItem
                      key={code}
                      value={code}
                      dir="auto"
                      data-testid={`language-option-${code}`}
                    >
                      {nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.releaseSortOrder}>
                {t("release_sort_order_label")}
              </Label>
              <Select
                value={releaseSortOrder}
                onValueChange={(value: ReleaseSortOrder) =>
                  setReleaseSortOrder(value)
                }
                disabled={!isOnline}
              >
                <SelectTrigger
                  id={ids.releaseSortOrder}
                  className="w-full sm:w-[260px]"
                >
                  <SelectValue placeholder={t("release_sort_latest_first")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_first">
                    {t("release_sort_latest_first")}
                  </SelectItem>
                  <SelectItem value="new_first">
                    {t("release_sort_new_first")}
                  </SelectItem>
                  <SelectItem value="oldest_first">
                    {t("release_sort_oldest_first")}
                  </SelectItem>
                  <SelectItem value="repo_az">
                    {t("release_sort_repo_az")}
                  </SelectItem>
                  <SelectItem value="repo_za">
                    {t("release_sort_repo_za")}
                  </SelectItem>
                  <SelectItem value="provider_grouped">
                    {t("release_sort_provider_grouped")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {releaseSortOrder === "provider_grouped" && (
              <div className="space-y-2">
                <Label htmlFor={ids.providerSortOrder}>
                  {t("provider_sort_order_label")}
                </Label>
                <Select
                  value={serializeProviderSortOrder(providerSortOrder)}
                  onValueChange={(value) =>
                    setProviderSortOrder(deserializeProviderSortOrder(value))
                  }
                  disabled={!isOnline}
                >
                  <SelectTrigger
                    id={ids.providerSortOrder}
                    className="w-full sm:w-[260px]"
                  >
                    <SelectValue
                      placeholder={t("provider_sort_order_placeholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {providerSortOrderOptions.map((option) => (
                      <SelectItem
                        key={serializeProviderSortOrder(option)}
                        value={serializeProviderSortOrder(option)}
                      >
                        {option
                          .map((provider) => t(`provider_${provider}`))
                          .join(" / ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.showAcknowledge}
                  checked={showAcknowledge}
                  onCheckedChange={(checked) =>
                    setShowAcknowledge(Boolean(checked))
                  }
                  disabled={!isOnline}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={ids.showAcknowledge}
                    className="font-medium cursor-pointer"
                  >
                    {t("show_acknowledge_title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("show_acknowledge_description")}
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  "ms-6 ps-3 border-s-2 transition-all duration-300 ease-in-out overflow-hidden",
                  showAcknowledge
                    ? "mt-4 max-h-96 opacity-100"
                    : "max-h-0 opacity-0",
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={ids.showMarkAsNew}
                    checked={showMarkAsNew}
                    onCheckedChange={(checked) =>
                      setShowMarkAsNew(Boolean(checked))
                    }
                    disabled={!showAcknowledge || !isOnline}
                    className="mt-1"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor={ids.showMarkAsNew}
                      className="font-medium cursor-pointer"
                    >
                      {t("show_mark_as_new_title")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("show_mark_as_new_description")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.showProviderPrefixInRepoId}
                  checked={showProviderPrefixInRepoId}
                  onCheckedChange={(checked) =>
                    setShowProviderPrefixInRepoId(Boolean(checked))
                  }
                  disabled={!isOnline}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={ids.showProviderPrefixInRepoId}
                    className="font-medium cursor-pointer"
                  >
                    {t("show_provider_prefix_in_repo_id_title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("show_provider_prefix_in_repo_id_description")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.showProviderDomainInRepoId}
                  checked={showProviderDomainInRepoId}
                  onCheckedChange={(checked) =>
                    setShowProviderDomainInRepoId(Boolean(checked))
                  }
                  disabled={!isOnline}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={ids.showProviderDomainInRepoId}
                    className="font-medium cursor-pointer"
                  >
                    {t("show_provider_domain_in_repo_id_title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("show_provider_domain_in_repo_id_description")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.repositoryFormExpanded}
                  checked={repositoryFormExpanded}
                  onCheckedChange={(checked) =>
                    setRepositoryFormExpanded(Boolean(checked))
                  }
                  disabled={!isOnline}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={ids.repositoryFormExpanded}
                    className="font-medium cursor-pointer"
                  >
                    {t("repository_form_expanded_title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("repository_form_expanded_description")}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("security_releases_settings_title")}</CardTitle>
            <CardDescription>
              {t("security_releases_settings_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.prioritizeNewSecurityReleases}
                checked={prioritizeNewSecurityReleases}
                onCheckedChange={(checked) =>
                  setPrioritizeNewSecurityReleases(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.prioritizeNewSecurityReleases}
                  className="font-medium cursor-pointer"
                >
                  {t("prioritize_new_security_releases_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("prioritize_new_security_releases_description")}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Label>{t("security_highlight_color_label")}</Label>
              <RadioGroup
                value={securityHighlightColorPreset}
                onValueChange={(value) =>
                  setSecurityHighlightColorPreset(
                    normalizeSecurityHighlightColorPreset(value),
                  )
                }
                className="grid gap-2 sm:grid-cols-2"
                disabled={!isOnline}
              >
                {securityHighlightColorOptions.map((option) => {
                  const optionId = `${ids.securityHighlightColor}-${option.value}`;
                  const customSwatchColor = isValidSecurityHighlightCustomColor(
                    securityHighlightCustomColor,
                  )
                    ? securityHighlightCustomColor
                    : defaultSecurityHighlightCustomColor;
                  return (
                    <div
                      key={option.value}
                      className="flex items-center gap-2 rounded-md border p-3"
                    >
                      <RadioGroupItem value={option.value} id={optionId} />
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-4 shrink-0 rounded-full border",
                          option.swatchClassName,
                        )}
                        style={
                          option.value === "custom"
                            ? { backgroundColor: customSwatchColor }
                            : undefined
                        }
                      />
                      <Label
                        htmlFor={optionId}
                        className="cursor-pointer font-normal"
                      >
                        {t(option.labelKey)}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
              {securityHighlightColorPreset === "custom" && (
                <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[auto_1fr]">
                  <div className="space-y-2">
                    <Label htmlFor={ids.securityHighlightCustomColorPicker}>
                      {t("security_highlight_color_picker_label")}
                    </Label>
                    <Input
                      id={ids.securityHighlightCustomColorPicker}
                      type="color"
                      value={
                        isValidSecurityHighlightCustomColor(
                          securityHighlightCustomColor,
                        )
                          ? securityHighlightCustomColor
                          : defaultSecurityHighlightCustomColor
                      }
                      onChange={(event) => {
                        requestImmediateSave();
                        setSecurityHighlightCustomColor(
                          event.target.value.toLowerCase(),
                        );
                      }}
                      disabled={!isOnline}
                      className="h-10 w-16 p-1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={ids.securityHighlightCustomColor}>
                      {t("security_highlight_hex_label")}
                    </Label>
                    <Input
                      id={ids.securityHighlightCustomColor}
                      dir="ltr"
                      value={securityHighlightCustomColor}
                      onChange={(event) =>
                        setSecurityHighlightCustomColor(event.target.value)
                      }
                      placeholder={defaultSecurityHighlightCustomColor}
                      disabled={!isOnline}
                      className={cn(
                        !!securityHighlightCustomColorError &&
                          "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    {securityHighlightCustomColorError ? (
                      <p className="text-sm text-destructive">
                        {t("security_highlight_hex_error_invalid")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t("security_highlight_hex_hint")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.confirmSecurityAcknowledge}
                checked={confirmSecurityAcknowledge}
                onCheckedChange={(checked) =>
                  setConfirmSecurityAcknowledge(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.confirmSecurityAcknowledge}
                  className="font-medium cursor-pointer"
                >
                  {t("confirm_security_acknowledge_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("confirm_security_acknowledge_description")}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.includeDefaultSecurityPatterns}
                  checked={includeDefaultSecurityPatterns}
                  onCheckedChange={(checked) =>
                    setIncludeDefaultSecurityPatterns(Boolean(checked))
                  }
                  disabled={!isOnline}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={ids.includeDefaultSecurityPatterns}
                    className="font-medium cursor-pointer"
                  >
                    {t("include_default_security_patterns_title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("include_default_security_patterns_description")}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.customSecurityPatterns}>
                  {t("custom_security_patterns_label")}
                </Label>
                <Textarea
                  id={ids.customSecurityPatterns}
                  dir="ltr"
                  value={customSecurityPatterns}
                  onChange={(event) =>
                    setCustomSecurityPatterns(event.target.value)
                  }
                  placeholder={t("custom_security_patterns_placeholder")}
                  disabled={!isOnline}
                  className={cn(
                    "min-h-32 font-mono text-sm",
                    !!customSecurityPatternsError &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {customSecurityPatternsError ? (
                  <p className="text-sm text-destructive">
                    {t("security_patterns_error_invalid")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("custom_security_patterns_hint")}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("release_channel_title")}</CardTitle>
            <CardDescription>
              {t("release_channel_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="font-medium">
                {t("release_channel_types_title")}
              </h3>
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
              <Label
                htmlFor={ids.stable}
                className="font-normal cursor-pointer"
              >
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
              <Label htmlFor={ids.includeRegex}>
                {t("include_regex_label")}
              </Label>
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
              <Label htmlFor={ids.excludeRegex}>
                {t("exclude_regex_label")}
              </Label>
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
                  <Label htmlFor={ids.cronPreset}>
                    {t("cron_preset_label")}
                  </Label>
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
                      onChange={(event) =>
                        setCronExpression(event.target.value)
                      }
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

        <Card>
          <CardHeader>
            <CardTitle>{t("notification_delivery_settings_title")}</CardTitle>
            <CardDescription>
              {t("notification_delivery_settings_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids.emailNotificationMode}>
                  {t("email_notification_mode_label")}
                </Label>
                <Select
                  value={emailNotificationMode}
                  onValueChange={(value: NotificationMode) =>
                    setEmailNotificationMode(value)
                  }
                  disabled={!isOnline}
                >
                  <SelectTrigger
                    id={ids.emailNotificationMode}
                    className="mt-2 w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_release">
                      {t("notification_mode_per_release")}
                    </SelectItem>
                    <SelectItem value="batch">
                      {t("notification_mode_batch")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={ids.appriseNotificationMode}>
                  {t("apprise_notification_mode_label")}
                </Label>
                <Select
                  value={appriseNotificationMode}
                  onValueChange={(value: NotificationMode) =>
                    setAppriseNotificationMode(value)
                  }
                  disabled={!isOnline}
                >
                  <SelectTrigger
                    id={ids.appriseNotificationMode}
                    className="mt-2 w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_release">
                      {t("notification_mode_per_release")}
                    </SelectItem>
                    <SelectItem value="batch">
                      {t("notification_mode_batch")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids.notificationMaxMessagesPerRun}>
                  {t("notification_max_messages_label")}
                </Label>
                <Input
                  id={ids.notificationMaxMessagesPerRun}
                  type="number"
                  value={notificationMaxMessagesPerRun}
                  onChange={(event) =>
                    setNotificationMaxMessagesPerRun(event.target.value)
                  }
                  min={0}
                  max={10000}
                  step={1}
                  disabled={!isOnline}
                  className="mt-2 w-full sm:w-48"
                  aria-invalid={Boolean(notificationMaxMessagesError)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("notification_max_messages_hint")}
                </p>
                {notificationMaxMessagesError && (
                  <p className="mt-2 text-xs text-destructive">
                    {t(
                      notificationMaxMessagesError === "invalid"
                        ? "integer_error_invalid"
                        : notificationMaxMessagesError === "too_low"
                          ? "notification_max_messages_error_min"
                          : "notification_max_messages_error_max",
                    )}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor={ids.notificationDeliveryConcurrency}>
                  {t("notification_delivery_concurrency_label")}
                </Label>
                <Input
                  id={ids.notificationDeliveryConcurrency}
                  type="number"
                  value={notificationDeliveryConcurrency}
                  onChange={(event) =>
                    setNotificationDeliveryConcurrency(event.target.value)
                  }
                  min={1}
                  max={50}
                  step={1}
                  disabled={!isOnline}
                  className="mt-2 w-full sm:w-48"
                  aria-invalid={Boolean(notificationDeliveryConcurrencyError)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("notification_delivery_concurrency_hint")}
                </p>
                {notificationDeliveryConcurrencyError && (
                  <p className="mt-2 text-xs text-destructive">
                    {t(
                      notificationDeliveryConcurrencyError === "invalid"
                        ? "integer_error_invalid"
                        : notificationDeliveryConcurrencyError === "too_low"
                          ? "notification_delivery_concurrency_error_min"
                          : "notification_delivery_concurrency_error_max",
                    )}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("notification_content_settings_title")}</CardTitle>
            <CardDescription>
              {t("notification_content_settings_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-3">
              <Checkbox
                id={ids.emailIncludeReleaseNotes}
                checked={emailIncludeReleaseNotes}
                onCheckedChange={(checked) =>
                  setEmailIncludeReleaseNotes(Boolean(checked))
                }
                disabled={!isOnline}
              />
              <Label
                htmlFor={ids.emailIncludeReleaseNotes}
                className="font-medium cursor-pointer"
              >
                {t("email_include_release_notes_label")}
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id={ids.appriseIncludeReleaseNotes}
                checked={appriseIncludeReleaseNotes}
                onCheckedChange={(checked) =>
                  setAppriseIncludeReleaseNotes(Boolean(checked))
                }
                disabled={!isOnline}
              />
              <Label
                htmlFor={ids.appriseIncludeReleaseNotes}
                className="font-medium cursor-pointer"
              >
                {t("apprise_include_release_notes_label")}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("apprise_settings_title")}</CardTitle>
            <CardDescription>
              {t("apprise_settings_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor={ids.appriseMaxChars}>
                {t("apprise_max_chars_label")}
              </Label>
              <Input
                id={ids.appriseMaxChars}
                type="number"
                value={appriseMaxCharacters}
                onChange={(e) => setAppriseMaxCharacters(e.target.value)}
                min={0}
                disabled={!isAppriseConfigured || !isOnline}
                className="mt-2 w-full sm:w-48"
              />
              {isAppriseConfigured ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_max_chars_hint")}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_max_chars_disabled_hint")}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor={ids.appriseFormat}>
                {t("apprise_format_label")}
              </Label>
              <Select
                value={appriseFormat}
                onValueChange={(value: AppriseFormat) =>
                  setAppriseFormat(value)
                }
                disabled={!isAppriseConfigured || !isOnline}
              >
                <SelectTrigger
                  id={ids.appriseFormat}
                  className="w-full sm:w-[180px] mt-2"
                >
                  <SelectValue placeholder={t("apprise_format_text")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    {t("apprise_format_text")}
                  </SelectItem>
                  <SelectItem value="markdown">
                    {t("apprise_format_markdown")}
                  </SelectItem>
                  <SelectItem value="html">
                    {t("apprise_format_html")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {isAppriseConfigured ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_format_hint")}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_format_disabled_hint")}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor={ids.appriseTags}>{t("apprise_tags_label")}</Label>
              <Input
                id={ids.appriseTags}
                dir="ltr"
                type="text"
                value={appriseTags}
                onChange={(e) => setAppriseTags(e.target.value)}
                disabled={!isAppriseConfigured || !isOnline}
                className="mt-2 w-full"
                placeholder={t("apprise_tags_placeholder")}
              />
              {isAppriseConfigured ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_tags_hint")}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apprise_tags_disabled_hint")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function SettingsDangerZoneCard() {
  const t = useTranslations("SettingsForm");
  const { toast } = useToast();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  const [isDeleting, startDeleteTransition] = React.useTransition();

  const handleDeleteAll = () => {
    startDeleteTransition(async () => {
      try {
        const result = await deleteAllRepositoriesAction();
        toast({
          title: result.message.title,
          description: result.message.description,
          variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
          router.push("/");
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_delete_all_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Card className="mt-6 border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">
          {t("danger_zone_title")}
        </CardTitle>
        <CardDescription className="text-destructive/80">
          {t("danger_zone_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isDeleting || !isOnline}>
              {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t("delete_all_button_text")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("delete_all_dialog_title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("delete_all_dialog_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting || !isOnline}>
                {t("cancel_button")}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteAll}
                disabled={isDeleting || !isOnline}
              >
                {isDeleting && <Loader2 className="animate-spin" />}
                {t("confirm_delete_button")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

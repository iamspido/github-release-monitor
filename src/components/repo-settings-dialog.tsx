"use client";

import {
  AlertCircle,
  CheckCircle,
  Loader2,
  RotateCcw,
  Save,
  WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import {
  refreshSingleRepositoryAction,
  updateRepositorySettingsAction,
} from "@/app/actions";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { formatRepoIdForDisplay } from "@/lib/repo-id-display";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type {
  AppriseFormat,
  AppSettings,
  PreReleaseChannelType,
  ReleaseChannel,
  Repository,
} from "@/types";
import { allPreReleaseTypes } from "@/types";
import { Input } from "./ui/input";

type SaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "success"
  | "error"
  | "paused";
type ReleasesPerPageError = "too_low" | "too_high" | null;
type IntervalValidationError = "too_low" | "too_high" | null;
type RegexError = "invalid" | null;
type CronError = "invalid" | null;
type AutomationMode = "global" | "interval" | "cron";
type CronPreset = "daily" | "weekdays" | "weekly" | "custom";

const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_HOUR = 60;
const MAX_INTERVAL_MINUTES = 5_256_000;

function minutesToDhms(totalMinutes: number) {
  const d = Math.floor(totalMinutes / MINUTES_IN_DAY);
  const h = Math.floor((totalMinutes % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
  const m = totalMinutes % MINUTES_IN_HOUR;
  return { d, h, m };
}

function getAutomationMode(
  settings?: Pick<Repository, "refreshInterval" | "backgroundCheckCron">,
): AutomationMode {
  if (settings?.backgroundCheckCron) return "cron";
  if (typeof settings?.refreshInterval === "number") return "interval";
  return "global";
}

function normalizeTimeInput(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "08:00";
}

function timeToCronParts(time: string) {
  const [hour = "8", minute = "0"] = normalizeTimeInput(time).split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

function inferCronPreset(cron: string | undefined): {
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

  return { ...fallback, preset: "custom", expression: cron };
}

function buildCronExpression(
  preset: CronPreset,
  time: string,
  weekday: string,
  customExpression: string,
) {
  if (preset === "custom") return customExpression.trim();
  const { hour, minute } = timeToCronParts(time);
  if (preset === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (preset === "weekly") return `${minute} ${hour} * * ${weekday}`;
  return `${minute} ${hour} * * *`;
}

function isValidFiveFieldCron(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return false;
  if (trimmed.split(" ").length !== 5) return false;
  return /^[-*/,\dA-Z?a-z]+ [-*/,\dA-Z?a-z]+ [-*/,\dA-Z?a-z]+ [-*/,\dA-Z?a-z]+ [-*/,\dA-Z?a-z]+$/.test(
    trimmed,
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const t = useTranslations("RepoSettingsDialog");
  const tLong = useTranslations("SettingsForm");

  if (status === "idle") {
    return null;
  }

  const messages: Record<
    SaveStatus,
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
      text: (
        <>
          <span className="sm:hidden">{t("autosave_success_short")}</span>
          <span className="hidden sm:inline">{tLong("autosave_success")}</span>
        </>
      ),
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
      className={cn(
        "flex items-center justify-end gap-2 text-sm transition-colors",
        current.className,
      )}
    >
      {current.icon}
      <span>{current.text}</span>
    </div>
  );
}

interface RepoSettingsDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  repoId: string;
  currentRepoSettings?: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "refreshInterval"
    | "cacheInterval"
    | "backgroundCheckCron"
    | "includeRegex"
    | "excludeRegex"
    | "appriseTags"
    | "appriseFormat"
  >;
  globalSettings: AppSettings;
}

export function RepoSettingsDialog({
  isOpen,
  setIsOpen,
  repoId,
  currentRepoSettings,
  globalSettings,
}: RepoSettingsDialogProps) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const { toast } = useToast();
  const displayRepoId = formatRepoIdForDisplay(repoId, {
    showProviderPrefix: globalSettings.showProviderPrefixInRepoId ?? true,
    showProviderDomain: globalSettings.showProviderDomainInRepoId ?? true,
  });

  // Generate unique IDs for form elements
  const stableId = React.useId();
  const prereleaseId = React.useId();
  const draftId = React.useId();
  const includeRegexId = React.useId();
  const excludeRegexId = React.useId();
  const releasesPerPageId = React.useId();
  const refreshModeId = React.useId();
  const intervalMinutesId = React.useId();
  const intervalHoursId = React.useId();
  const intervalDaysId = React.useId();
  const cacheOverrideId = React.useId();
  const cacheMinutesId = React.useId();
  const cacheHoursId = React.useId();
  const cacheDaysId = React.useId();
  const cronPresetId = React.useId();
  const cronHourId = React.useId();
  const cronMinuteId = React.useId();
  const cronPeriodId = React.useId();
  const cronWeekdayId = React.useId();
  const cronExpressionId = React.useId();
  const appriseFormatId = React.useId();
  const appriseTagsId = React.useId();
  const prereleaseSubChannelBaseId = React.useId();

  const [channels, setChannels] = React.useState<ReleaseChannel[]>(
    currentRepoSettings?.releaseChannels ?? [],
  );
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<
    PreReleaseChannelType[] | undefined
  >(currentRepoSettings?.preReleaseSubChannels);
  const [releasesPerPage, setReleasesPerPage] = React.useState<string | number>(
    currentRepoSettings?.releasesPerPage ?? "",
  );
  const [automationMode, setAutomationMode] = React.useState<AutomationMode>(
    getAutomationMode(currentRepoSettings),
  );
  const [intervalDays, setIntervalDays] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.refreshInterval ?? 60).d),
  );
  const [intervalHours, setIntervalHours] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.refreshInterval ?? 60).h),
  );
  const [intervalMinutes, setIntervalMinutes] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.refreshInterval ?? 60).m),
  );
  const [useCustomCache, setUseCustomCache] = React.useState(
    typeof currentRepoSettings?.cacheInterval === "number",
  );
  const [cacheDays, setCacheDays] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.cacheInterval ?? 0).d),
  );
  const [cacheHours, setCacheHours] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.cacheInterval ?? 0).h),
  );
  const [cacheMinutes, setCacheMinutes] = React.useState(() =>
    String(minutesToDhms(currentRepoSettings?.cacheInterval ?? 0).m),
  );
  const cronInitial = React.useMemo(
    () =>
      inferCronPreset(currentRepoSettings?.backgroundCheckCron ?? undefined),
    [currentRepoSettings?.backgroundCheckCron],
  );
  const [cronPreset, setCronPreset] = React.useState<CronPreset>(
    cronInitial.preset,
  );
  const [cronTime, setCronTime] = React.useState(cronInitial.time);
  const [cronWeekday, setCronWeekday] = React.useState(cronInitial.weekday);
  const [cronExpression, setCronExpression] = React.useState(
    cronInitial.expression,
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

  const [releasesPerPageError, setReleasesPerPageError] =
    React.useState<ReleasesPerPageError>(null);
  const [intervalError, setIntervalError] =
    React.useState<IntervalValidationError>(null);
  const [isCacheInvalid, setIsCacheInvalid] = React.useState(false);
  const [cronError, setCronError] = React.useState<CronError>(null);
  const [includeRegexError, setIncludeRegexError] =
    React.useState<RegexError>(null);
  const [excludeRegexError, setExcludeRegexError] =
    React.useState<RegexError>(null);

  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const { isOnline } = useNetworkStatus();

  const savedThisSessionRef = React.useRef(false);
  const filterSettingsChangedRef = React.useRef(false);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const prevIsOpenRef = React.useRef(isOpen);
  React.useEffect(() => {
    const wasOpen = prevIsOpenRef.current;

    // transition: closed -> open
    if (!wasOpen && isOpen) {
      const initialSettings = {
        releaseChannels: currentRepoSettings?.releaseChannels ?? [],
        preReleaseSubChannels: currentRepoSettings?.preReleaseSubChannels,
        releasesPerPage: currentRepoSettings?.releasesPerPage ?? null,
        refreshInterval: currentRepoSettings?.refreshInterval ?? null,
        cacheInterval: currentRepoSettings?.cacheInterval ?? null,
        backgroundCheckCron:
          currentRepoSettings?.backgroundCheckCron ?? undefined,
        includeRegex: currentRepoSettings?.includeRegex ?? undefined,
        excludeRegex: currentRepoSettings?.excludeRegex ?? undefined,
        appriseTags: currentRepoSettings?.appriseTags ?? undefined,
        appriseFormat: currentRepoSettings?.appriseFormat ?? undefined,
      };

      setChannels(initialSettings.releaseChannels);
      setPreReleaseSubChannels(initialSettings.preReleaseSubChannels);
      setReleasesPerPage(initialSettings.releasesPerPage ?? "");
      setAutomationMode(getAutomationMode(initialSettings));
      const intervalParts = minutesToDhms(
        initialSettings.refreshInterval ?? 60,
      );
      setIntervalDays(String(intervalParts.d));
      setIntervalHours(String(intervalParts.h));
      setIntervalMinutes(String(intervalParts.m));
      setUseCustomCache(typeof initialSettings.cacheInterval === "number");
      const cacheParts = minutesToDhms(initialSettings.cacheInterval ?? 0);
      setCacheDays(String(cacheParts.d));
      setCacheHours(String(cacheParts.h));
      setCacheMinutes(String(cacheParts.m));
      const inferredCron = inferCronPreset(initialSettings.backgroundCheckCron);
      setCronPreset(inferredCron.preset);
      setCronTime(inferredCron.time);
      setCronWeekday(inferredCron.weekday);
      setCronExpression(inferredCron.expression);
      setIncludeRegex(initialSettings.includeRegex ?? "");
      setExcludeRegex(initialSettings.excludeRegex ?? "");
      setAppriseTags(initialSettings.appriseTags ?? "");
      setAppriseFormat(initialSettings.appriseFormat ?? "");

      setSaveStatus("idle");

      savedThisSessionRef.current = false;
      filterSettingsChangedRef.current = false;

      prevSettingsRef.current = {
        ...initialSettings,
        releasesPerPage: initialSettings.releasesPerPage,
      };
    }

    if (wasOpen && !isOpen) {
      if (savedThisSessionRef.current && filterSettingsChangedRef.current) {
        // Fire and forget; avoid unhandled rejection on flaky connections
        refreshSingleRepositoryAction(repoId).catch((error: unknown) => {
          if (reloadIfServerActionStale(error)) {
            return;
          }
        });
        savedThisSessionRef.current = false;
        filterSettingsChangedRef.current = false;
      } else if (savedThisSessionRef.current) {
        // Settings were saved but no filter changes - no refresh needed
        savedThisSessionRef.current = false;
      }
    }

    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentRepoSettings, repoId]);

  const useGlobalChannels = channels.length === 0;
  const useGlobalSubChannels = preReleaseSubChannels === undefined;
  const useGlobalReleasesPerPage = String(releasesPerPage).trim() === "";
  const useGlobalAutomation = automationMode === "global" && !useCustomCache;
  const useGlobalIncludeRegex = includeRegex.trim() === "";
  const useGlobalExcludeRegex = excludeRegex.trim() === "";
  const useGlobalAppriseTags = appriseTags.trim() === "";
  const useGlobalAppriseFormat = appriseFormat === "";

  const isUsingAllGlobalSettings =
    useGlobalChannels &&
    useGlobalReleasesPerPage &&
    useGlobalAutomation &&
    useGlobalIncludeRegex &&
    useGlobalExcludeRegex &&
    useGlobalAppriseTags &&
    useGlobalAppriseFormat;

  const newSettings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "refreshInterval"
    | "cacheInterval"
    | "backgroundCheckCron"
    | "includeRegex"
    | "excludeRegex"
    | "appriseTags"
    | "appriseFormat"
  > = React.useMemo(() => {
    let finalReleasesPerPage: number | null = null;
    const releasesPerPageStr = String(releasesPerPage).trim();

    if (releasesPerPageStr !== "") {
      const parsed = parseInt(releasesPerPageStr, 10);
      if (!Number.isNaN(parsed)) {
        finalReleasesPerPage = parsed;
      }
    }

    const parsedIntervalDays = parseInt(intervalDays, 10) || 0;
    const parsedIntervalHours = parseInt(intervalHours, 10) || 0;
    const parsedIntervalMinutes = parseInt(intervalMinutes, 10) || 0;
    const finalRefreshInterval =
      automationMode === "interval"
        ? parsedIntervalDays * MINUTES_IN_DAY +
          parsedIntervalHours * MINUTES_IN_HOUR +
          parsedIntervalMinutes
        : null;

    const parsedCacheDays = parseInt(cacheDays, 10) || 0;
    const parsedCacheHours = parseInt(cacheHours, 10) || 0;
    const parsedCacheMinutes = parseInt(cacheMinutes, 10) || 0;
    const finalCacheInterval = useCustomCache
      ? parsedCacheDays * MINUTES_IN_DAY +
        parsedCacheHours * MINUTES_IN_HOUR +
        parsedCacheMinutes
      : null;

    const finalCron =
      automationMode === "cron"
        ? buildCronExpression(cronPreset, cronTime, cronWeekday, cronExpression)
        : undefined;

    return {
      releaseChannels: channels,
      preReleaseSubChannels: preReleaseSubChannels ?? [],
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
    channels,
    preReleaseSubChannels,
    releasesPerPage,
    automationMode,
    intervalDays,
    intervalHours,
    intervalMinutes,
    useCustomCache,
    cacheDays,
    cacheHours,
    cacheMinutes,
    cronPreset,
    cronTime,
    cronWeekday,
    cronExpression,
    includeRegex,
    excludeRegex,
    appriseTags,
    appriseFormat,
  ]);

  const prevSettingsRef = React.useRef(newSettings);

  React.useEffect(() => {
    if (String(releasesPerPage).trim() !== "") {
      const numReleases = parseInt(String(releasesPerPage), 10);
      if (Number.isNaN(numReleases)) {
        setReleasesPerPageError(null);
      } else if (numReleases < 1) {
        setReleasesPerPageError("too_low");
      } else if (numReleases > 1000) {
        setReleasesPerPageError("too_high");
      } else {
        setReleasesPerPageError(null);
      }
    } else {
      setReleasesPerPageError(null);
    }

    if (automationMode === "interval") {
      const fieldsFilled =
        intervalDays !== "" && intervalHours !== "" && intervalMinutes !== "";
      if (fieldsFilled) {
        const interval = newSettings.refreshInterval ?? 0;
        if (interval < 1) {
          setIntervalError("too_low");
        } else if (interval > MAX_INTERVAL_MINUTES) {
          setIntervalError("too_high");
        } else {
          setIntervalError(null);
        }
      } else {
        setIntervalError(null);
      }
    } else {
      setIntervalError(null);
    }

    const cacheFieldsFilled =
      cacheDays !== "" && cacheHours !== "" && cacheMinutes !== "";
    const effectiveAutomationUsesInterval =
      automationMode === "interval" ||
      (automationMode === "global" && !globalSettings.backgroundCheckCron);
    const effectiveRefreshInterval =
      automationMode === "interval"
        ? (newSettings.refreshInterval ?? 0)
        : globalSettings.refreshInterval;
    const cacheIsLarger =
      effectiveAutomationUsesInterval &&
      useCustomCache &&
      cacheFieldsFilled &&
      (newSettings.cacheInterval ?? 0) > 0 &&
      (newSettings.cacheInterval ?? 0) > effectiveRefreshInterval;
    setIsCacheInvalid(cacheIsLarger);

    if (automationMode === "cron") {
      const cron = newSettings.backgroundCheckCron ?? "";
      setCronError(isValidFiveFieldCron(cron) ? null : "invalid");
    } else {
      setCronError(null);
    }

    if (!includeRegex.trim()) {
      setIncludeRegexError(null);
    } else {
      try {
        new RegExp(includeRegex);
        setIncludeRegexError(null);
      } catch {
        setIncludeRegexError("invalid");
      }
    }

    if (!excludeRegex.trim()) {
      setExcludeRegexError(null);
    } else {
      try {
        new RegExp(excludeRegex);
        setExcludeRegexError(null);
      } catch {
        setExcludeRegexError("invalid");
      }
    }
  }, [
    releasesPerPage,
    automationMode,
    intervalDays,
    intervalHours,
    intervalMinutes,
    cacheDays,
    cacheHours,
    cacheMinutes,
    useCustomCache,
    newSettings.refreshInterval,
    newSettings.cacheInterval,
    newSettings.backgroundCheckCron,
    globalSettings.refreshInterval,
    globalSettings.backgroundCheckCron,
    includeRegex,
    excludeRegex,
  ]);

  React.useEffect(() => {
    if (!isOpen) return;

    if (!isOnline) {
      setSaveStatus("paused");
      return;
    }

    if (
      JSON.stringify(newSettings) === JSON.stringify(prevSettingsRef.current)
    ) {
      return;
    }

    if (
      releasesPerPageError ||
      intervalError ||
      isCacheInvalid ||
      cronError ||
      includeRegexError ||
      excludeRegexError
    ) {
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("waiting");

    const handler = setTimeout(async () => {
      if (mountedRef.current) setSaveStatus("saving");

      try {
        const result = await updateRepositorySettingsAction(
          repoId,
          newSettings,
        );

        if (result.success) {
          if (mountedRef.current) {
            setSaveStatus("success");

            // Track if filter settings changed to determine if refresh is needed
            const filtersChanged =
              (prevSettingsRef.current.includeRegex ?? "").trim() !==
                (newSettings.includeRegex ?? "").trim() ||
              (prevSettingsRef.current.excludeRegex ?? "").trim() !==
                (newSettings.excludeRegex ?? "").trim();

            const channelsChanged =
              JSON.stringify(
                (prevSettingsRef.current.releaseChannels || []).sort(),
              ) !== JSON.stringify((newSettings.releaseChannels || []).sort());

            const preSubsChanged =
              JSON.stringify(
                (prevSettingsRef.current.preReleaseSubChannels || []).sort(),
              ) !==
              JSON.stringify((newSettings.preReleaseSubChannels || []).sort());

            const rppChanged =
              prevSettingsRef.current.releasesPerPage !==
              newSettings.releasesPerPage;

            if (
              filtersChanged ||
              channelsChanged ||
              preSubsChanged ||
              rppChanged
            ) {
              filterSettingsChangedRef.current = true;
            }

            prevSettingsRef.current = newSettings;
            savedThisSessionRef.current = true;
          } else {
            savedThisSessionRef.current = true;
          }
        } else {
          if (mountedRef.current) {
            setSaveStatus("error");
            toast({
              title: t("toast_error_title"),
              description: result.error,
              variant: "destructive",
            });
          }
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        if (mountedRef.current) {
          setSaveStatus("error");
          toast({
            title: t("toast_error_title"),
            description: String(error),
            variant: "destructive",
          });
        }
      }
    }, 1500);

    return () => clearTimeout(handler);
  }, [
    newSettings,
    repoId,
    isOpen,
    releasesPerPageError,
    intervalError,
    isCacheInvalid,
    cronError,
    includeRegexError,
    excludeRegexError,
    toast,
    t,
    isOnline,
  ]);

  const handleChannelChange = (channel: ReleaseChannel) => {
    if (!isOnline) return;
    const baseChannels = useGlobalChannels
      ? globalSettings.releaseChannels
      : channels;

    const newChannels = baseChannels.includes(channel)
      ? baseChannels.filter((c) => c !== channel)
      : [...baseChannels, channel];

    if (newChannels.length === 0) {
      toast({
        title: t("toast_error_title"),
        description: t("release_channel_error_at_least_one"),
        variant: "destructive",
      });
      return;
    }

    setChannels(newChannels);

    if (
      useGlobalChannels &&
      useGlobalSubChannels &&
      channel === "prerelease" &&
      newChannels.includes("prerelease")
    ) {
      setPreReleaseSubChannels(
        globalSettings.preReleaseSubChannels || allPreReleaseTypes,
      );
    }
  };

  const handlePreReleaseSubChannelChange = (
    subChannel: PreReleaseChannelType,
  ) => {
    if (!isOnline) return;
    const baseSubChannels = useGlobalSubChannels
      ? globalSettings.preReleaseSubChannels || allPreReleaseTypes
      : preReleaseSubChannels || [];

    const newSubChannels = baseSubChannels.includes(subChannel)
      ? baseSubChannels.filter((sc) => sc !== subChannel)
      : [...baseSubChannels, subChannel];
    setPreReleaseSubChannels(newSubChannels);
  };

  const handleSelectAllPreRelease = () => {
    if (!isOnline) return;
    setPreReleaseSubChannels(allPreReleaseTypes);
  };

  const handleDeselectAllPreRelease = () => {
    if (!isOnline) return;
    setPreReleaseSubChannels([]);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  const resetAutomationOverrideState = () => {
    const intervalParts = minutesToDhms(globalSettings.refreshInterval);
    const cacheParts = minutesToDhms(globalSettings.cacheInterval);

    setAutomationMode("global");
    setIntervalDays(String(intervalParts.d));
    setIntervalHours(String(intervalParts.h));
    setIntervalMinutes(String(intervalParts.m));
    setUseCustomCache(false);
    setCacheDays(String(cacheParts.d));
    setCacheHours(String(cacheParts.h));
    setCacheMinutes(String(cacheParts.m));
    setCronPreset("daily");
    setCronTime("08:00");
    setCronWeekday("1");
    setCronExpression("");
  };

  const handleResetAll = () => {
    if (!isOnline) return;
    setChannels([]);
    setPreReleaseSubChannels([]);
    setReleasesPerPage("");
    resetAutomationOverrideState();
    setIncludeRegex("");
    setExcludeRegex("");
    setAppriseTags("");
    setAppriseFormat("");
  };

  const handleResetFilters = () => {
    if (!isOnline) return;
    setChannels([]);
    setPreReleaseSubChannels([]);
    setIncludeRegex("");
    setExcludeRegex("");
  };

  const handleResetAutomation = () => {
    if (!isOnline) return;
    resetAutomationOverrideState();
  };

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

  const isAppriseConfigured = !!globalSettings.appriseMaxCharacters;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t.rich("description_flexible", {
              repoId: () => (
                <span className="font-semibold text-foreground">
                  {displayRepoId}
                </span>
              ),
            })}
          </DialogDescription>
        </DialogHeader>

        {!isOnline && (
          <div className="mb-3 mt-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-300">
            {tGlobal("offline_notice")}
          </div>
        )}

        <div className="space-y-6 pt-2 max-h-[60vh] overflow-y-auto pr-2 -mr-4 pb-4">
          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">
                {tGlobal("release_channel_title")}
              </h4>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleResetFilters}
                      className="size-8 shrink-0"
                      disabled={!isOnline}
                      aria-disabled={!isOnline}
                    >
                      <RotateCcw className="size-4" />
                      <span className="sr-only">
                        {t("reset_to_global_button")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("reset_to_global_tooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              {useGlobalChannels
                ? t("channels_hint_global")
                : t("channels_hint_individual")}
            </p>
            <p className="text-xs text-muted-foreground">
              {tGlobal("release_channel_description_repo")}
            </p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id={stableId}
                checked={isStableChecked}
                onCheckedChange={() => handleChannelChange("stable")}
                disabled={!isOnline}
              />
              <Label htmlFor={stableId} className="font-normal cursor-pointer">
                {tGlobal("release_channel_stable")}
              </Label>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={prereleaseId}
                  checked={isPreReleaseChecked}
                  onCheckedChange={() => handleChannelChange("prerelease")}
                  disabled={!isOnline}
                />
                <Label
                  htmlFor={prereleaseId}
                  className="font-normal cursor-pointer"
                >
                  {tGlobal("release_channel_prerelease")}
                </Label>
              </div>

              <div
                className={cn(
                  "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
                  isPreReleaseChecked
                    ? "mt-4 max-h-[600px] opacity-100"
                    : "max-h-0 opacity-0",
                )}
              >
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {tGlobal("prerelease_subtype_description")}
                  </p>
                  <div className="flex gap-2 mb-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAllPreRelease}
                      disabled={
                        !isPreReleaseChecked ||
                        saveStatus === "saving" ||
                        !isOnline
                      }
                    >
                      {tGlobal("prerelease_select_all")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDeselectAllPreRelease}
                      disabled={
                        !isPreReleaseChecked ||
                        saveStatus === "saving" ||
                        !isOnline
                      }
                    >
                      {tGlobal("prerelease_deselect_all")}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                    {allPreReleaseTypes.map((subType) => {
                      const subChannelId = `${prereleaseSubChannelBaseId}-${subType}`;
                      return (
                        <div
                          key={subType}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={subChannelId}
                            checked={effectivePreReleaseSubChannels.includes(
                              subType,
                            )}
                            onCheckedChange={() =>
                              handlePreReleaseSubChannelChange(subType)
                            }
                            disabled={!isPreReleaseChecked || !isOnline}
                          />
                          <Label
                            htmlFor={subChannelId}
                            className="font-normal cursor-pointer text-sm"
                          >
                            {subType}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id={draftId}
                checked={isDraftChecked}
                onCheckedChange={() => handleChannelChange("draft")}
                disabled={!isOnline}
              />
              <Label htmlFor={draftId} className="font-normal cursor-pointer">
                {tGlobal("release_channel_draft")}
              </Label>
            </div>

            <div className="space-y-2 pt-4">
              <h4 className="font-medium text-base">
                {tGlobal("regex_filter_title")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {tGlobal("regex_filter_description_repo")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={includeRegexId}>
                {tGlobal("include_regex_label")}
              </Label>
              <Input
                id={includeRegexId}
                value={includeRegex}
                onChange={(e) => setIncludeRegex(e.target.value)}
                placeholder={
                  globalSettings.includeRegex || tGlobal("regex_placeholder")
                }
                className={cn(
                  !!includeRegexError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
                disabled={!isOnline}
              />
              {includeRegexError && (
                <p className="text-sm text-destructive">
                  {tGlobal("regex_error_invalid")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={excludeRegexId}>
                {tGlobal("exclude_regex_label")}
              </Label>
              <Input
                id={excludeRegexId}
                value={excludeRegex}
                onChange={(e) => setExcludeRegex(e.target.value)}
                placeholder={
                  globalSettings.excludeRegex || tGlobal("regex_placeholder")
                }
                className={cn(
                  !!excludeRegexError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
                disabled={!isOnline}
              />
              {excludeRegexError && (
                <p className="text-sm text-destructive">
                  {tGlobal("regex_error_invalid")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">
                {t("automation_title")}
              </h4>
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
                      <span className="sr-only">
                        {t("reset_to_global_button")}
                      </span>
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
              <Label htmlFor={refreshModeId}>
                {t("automation_mode_label")}
              </Label>
              <Select
                value={automationMode}
                onValueChange={(value: AutomationMode) =>
                  setAutomationMode(value)
                }
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
                  <SelectItem value="cron">
                    {t("automation_mode_cron")}
                  </SelectItem>
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
                    onValueChange={(value: CronPreset) => setCronPreset(value)}
                    disabled={!isOnline}
                  >
                    <SelectTrigger id={cronPresetId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">
                        {t("cron_preset_daily")}
                      </SelectItem>
                      <SelectItem value="weekdays">
                        {t("cron_preset_weekdays")}
                      </SelectItem>
                      <SelectItem value="weekly">
                        {t("cron_preset_weekly")}
                      </SelectItem>
                      <SelectItem value="custom">
                        {t("cron_preset_custom")}
                      </SelectItem>
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
                        onChange={setCronTime}
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
                          onValueChange={setCronWeekday}
                          disabled={!isOnline}
                        >
                          <SelectTrigger id={cronWeekdayId}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">
                              {t("cron_weekday_monday")}
                            </SelectItem>
                            <SelectItem value="2">
                              {t("cron_weekday_tuesday")}
                            </SelectItem>
                            <SelectItem value="3">
                              {t("cron_weekday_wednesday")}
                            </SelectItem>
                            <SelectItem value="4">
                              {t("cron_weekday_thursday")}
                            </SelectItem>
                            <SelectItem value="5">
                              {t("cron_weekday_friday")}
                            </SelectItem>
                            <SelectItem value="6">
                              {t("cron_weekday_saturday")}
                            </SelectItem>
                            <SelectItem value="0">
                              {t("cron_weekday_sunday")}
                            </SelectItem>
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
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      placeholder="0 8 * * *"
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

            <div className="flex items-start space-x-3 border-t pt-4">
              <Checkbox
                id={cacheOverrideId}
                checked={useCustomCache}
                onCheckedChange={(checked) =>
                  setUseCustomCache(Boolean(checked))
                }
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

          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">
                {t("releases_per_page_label_repo")}
              </h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {useGlobalReleasesPerPage
                ? t("releases_per_page_hint_global")
                : t("releases_per_page_hint_individual")}
            </p>
            <div className="flex items-center gap-2">
              <Input
                id={releasesPerPageId}
                type="number"
                value={releasesPerPage}
                onChange={(e) => setReleasesPerPage(e.target.value)}
                min={1}
                max={1000}
                placeholder={t("releases_per_page_placeholder", {
                  count: globalSettings.releasesPerPage,
                })}
                className={cn(
                  !!releasesPerPageError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
                disabled={!isOnline}
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setReleasesPerPage("")}
                      className="size-8 shrink-0"
                      disabled={!isOnline}
                    >
                      <RotateCcw className="size-4" />
                      <span className="sr-only">
                        {t("reset_to_global_button")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("reset_to_global_tooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {releasesPerPageError === "too_low" ? (
              <p className="mt-2 text-sm text-destructive">
                {tGlobal("releases_per_page_error_min")}
              </p>
            ) : releasesPerPageError === "too_high" ? (
              <p className="mt-2 text-sm text-destructive">
                {tGlobal("releases_per_page_error_max_1000")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {tGlobal("releases_per_page_hint_1000")}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {tGlobal("releases_per_page_api_call_hint")}
            </p>
          </div>

          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">
                {tGlobal("apprise_settings_title")}
              </h4>
            </div>

            <p className="text-xs text-muted-foreground">
              {useGlobalAppriseTags && useGlobalAppriseFormat
                ? t("apprise_settings_hint_global")
                : t("apprise_settings_hint_individual")}
            </p>

            <div className="space-y-2">
              <Label htmlFor={appriseFormatId}>
                {tGlobal("apprise_format_label")}
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={appriseFormat}
                  onValueChange={(value: AppriseFormat | "global") =>
                    setAppriseFormat(value === "global" ? "" : value)
                  }
                  disabled={!isAppriseConfigured || !isOnline}
                >
                  <SelectTrigger id={appriseFormatId}>
                    <SelectValue
                      placeholder={t("apprise_format_placeholder", {
                        format: globalSettings.appriseFormat || "text",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">
                      {t("apprise_format_option_global", {
                        format: globalSettings.appriseFormat || "text",
                      })}
                    </SelectItem>
                    <SelectItem value="text">
                      {tGlobal("apprise_format_text")}
                    </SelectItem>
                    <SelectItem value="markdown">
                      {tGlobal("apprise_format_markdown")}
                    </SelectItem>
                    <SelectItem value="html">
                      {tGlobal("apprise_format_html")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAppriseFormat("")}
                        className="size-8 shrink-0"
                        disabled={!isOnline}
                      >
                        <RotateCcw className="size-4" />
                        <span className="sr-only">
                          {t("reset_to_global_button")}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("reset_to_global_tooltip")}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {!isAppriseConfigured && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {tGlobal("apprise_format_disabled_hint")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor={appriseTagsId}>{t("apprise_tags_label")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={appriseTagsId}
                  type="text"
                  value={appriseTags}
                  onChange={(e) => setAppriseTags(e.target.value)}
                  placeholder={t("apprise_tags_placeholder", {
                    tags: globalSettings.appriseTags || "...",
                  })}
                  disabled={!isAppriseConfigured || !isOnline}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAppriseTags("")}
                        className="size-8 shrink-0"
                        disabled={!isOnline}
                      >
                        <RotateCcw className="size-4" />
                        <span className="sr-only">
                          {t("reset_to_global_button")}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("reset_to_global_tooltip")}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {!isAppriseConfigured && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {tGlobal("apprise_tags_disabled_hint")}
                </p>
              )}
            </div>
          </div>

          <div className="pt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={isUsingAllGlobalSettings || !isOnline}
                >
                  <RotateCcw className="mr-2 size-4" />
                  {t("reset_all_button_text")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("reset_all_dialog_title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("reset_all_dialog_description")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {tGlobal("cancel_button")}
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetAll}>
                    {t("reset_all_confirm_button")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <DialogFooter className="pt-4">
          <SaveStatusIndicator status={saveStatus} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

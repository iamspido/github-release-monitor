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
  updateSettingsAction,
} from "@/app/settings/actions";
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
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type {
  AppriseFormat,
  AppSettings,
  Locale,
  PreReleaseChannelType,
  ReleaseChannel,
  TimeFormat,
} from "@/types";
import { allPreReleaseTypes } from "@/types";

const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_HOUR = 60;
const MAX_INTERVAL_MINUTES = 5256000;

function minutesToDhms(totalMinutes: number) {
  const d = Math.floor(totalMinutes / MINUTES_IN_DAY);
  const h = Math.floor((totalMinutes % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
  const m = totalMinutes % MINUTES_IN_HOUR;
  return { d, h, m };
}

type SaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "success"
  | "error"
  | "paused";
type IntervalValidationError = "too_low" | "too_high" | null;
type ReleasesPerPageError = "too_low" | "too_high" | null;
type ParallelRepoFetchError = "too_low" | "too_high" | null;
type RegexError = "invalid" | null;

function FloatingSaveIndicator({ status }: { status: SaveStatus }) {
  const t = useTranslations("SettingsForm");

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
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-background shadow-lg transition-all duration-300 ease-in-out",
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
}

export function SettingsForm({
  currentSettings,
  isAppriseConfigured,
  isGithubTokenSet,
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
      showAcknowledge: `${baseId}-show-acknowledge`,
      showMarkAsNew: `${baseId}-show-mark-new`,
      stable: `${baseId}-stable`,
      prerelease: `${baseId}-prerelease`,
      draft: `${baseId}-draft`,
      includeRegex: `${baseId}-include-regex`,
      excludeRegex: `${baseId}-exclude-regex`,
      intervalMinutes: `${baseId}-interval-minutes`,
      intervalHours: `${baseId}-interval-hours`,
      intervalDays: `${baseId}-interval-days`,
      cacheMinutes: `${baseId}-cache-minutes`,
      cacheHours: `${baseId}-cache-hours`,
      cacheDays: `${baseId}-cache-days`,
      releasesPerPage: `${baseId}-releases-per-page`,
      parallelRepoFetches: `${baseId}-parallel-fetches`,
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
  const [showAcknowledge, setShowAcknowledge] = React.useState<boolean>(
    currentSettings.showAcknowledge ?? true,
  );
  const [showMarkAsNew, setShowMarkAsNew] = React.useState<boolean>(
    currentSettings.showMarkAsNew ?? true,
  );
  const [includeRegex, setIncludeRegex] = React.useState(
    currentSettings.includeRegex ?? "",
  );
  const [excludeRegex, setExcludeRegex] = React.useState(
    currentSettings.excludeRegex ?? "",
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

  const [intervalError, setIntervalError] =
    React.useState<IntervalValidationError>(null);
  const [releasesPerPageError, setReleasesPerPageError] =
    React.useState<ReleasesPerPageError>(null);
  const [parallelRepoFetchesError, setParallelRepoFetchesError] =
    React.useState<ParallelRepoFetchError>(null);
  const [isCacheInvalid, setIsCacheInvalid] = React.useState(false);
  const [includeRegexError, setIncludeRegexError] =
    React.useState<RegexError>(null);
  const [excludeRegexError, setExcludeRegexError] =
    React.useState<RegexError>(null);

  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const isInitialMount = React.useRef(true);

  const [isDeleting, startDeleteTransition] = React.useTransition();

  // Check for saved state after locale change
  React.useEffect(() => {
    const savedAfterLocaleChange = sessionStorage.getItem(
      "settingsSavedAfterLocaleChange",
    );
    if (savedAfterLocaleChange === "true") {
      sessionStorage.removeItem("settingsSavedAfterLocaleChange");
      setSaveStatus("success");
      // Auto-hide success message after 3 seconds
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, []);

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

    return {
      timeFormat,
      locale,
      refreshInterval: totalMinutes,
      cacheInterval: totalCacheMinutes,
      releasesPerPage: parseInt(releasesPerPage, 10) || 30,
      parallelRepoFetches:
        parseInt(parallelRepoFetches, 10) ||
        currentSettings.parallelRepoFetches ||
        1,
      releaseChannels: channels,
      preReleaseSubChannels,
      showAcknowledge,
      showMarkAsNew,
      includeRegex: includeRegex,
      excludeRegex: excludeRegex,
      appriseMaxCharacters: isNaN(parsedAppriseChars)
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
    releasesPerPage,
    parallelRepoFetches,
    timeFormat,
    locale,
    channels,
    preReleaseSubChannels,
    showAcknowledge,
    showMarkAsNew,
    includeRegex,
    excludeRegex,
    appriseMaxCharacters,
    appriseTags,
    appriseFormat,
    currentSettings.parallelRepoFetches,
  ]);

  // Validation Effect
  React.useEffect(() => {
    const refreshFieldsFilled = days !== "" && hours !== "" && minutes !== "";
    const cacheFieldsFilled =
      cacheDays !== "" && cacheHours !== "" && cacheMinutes !== "";
    const releasesPerPageFilled = releasesPerPage !== "";
    const parallelRepoFetchesFilled = parallelRepoFetches !== "";

    // Refresh Interval Validation
    if (refreshFieldsFilled) {
      if (newSettings.refreshInterval < 1) {
        setIntervalError("too_low");
      } else if (newSettings.refreshInterval > MAX_INTERVAL_MINUTES) {
        setIntervalError("too_high");
      } else {
        setIntervalError(null);
      }
    } else {
      setIntervalError(null);
    }

    // Releases Per Page Validation
    if (releasesPerPageFilled) {
      const numReleases = parseInt(releasesPerPage, 10);
      if (numReleases < 1) {
        setReleasesPerPageError("too_low");
      } else if (numReleases > 1000) {
        setReleasesPerPageError("too_high");
      } else {
        setReleasesPerPageError(null);
      }
    } else {
      setReleasesPerPageError(null);
    }

    // Parallel Repo Fetches Validation
    if (parallelRepoFetchesFilled) {
      const numParallel = parseInt(parallelRepoFetches, 10);
      if (numParallel < 1) {
        setParallelRepoFetchesError("too_low");
      } else if (numParallel > 50) {
        setParallelRepoFetchesError("too_high");
      } else {
        setParallelRepoFetchesError(null);
      }
    } else {
      setParallelRepoFetchesError(null);
    }

    // Include Regex Validation
    if (!includeRegex.trim()) {
      setIncludeRegexError(null);
    } else {
      try {
        new RegExp(includeRegex);
        setIncludeRegexError(null);
      } catch (e) {
        setIncludeRegexError("invalid");
      }
    }

    // Exclude Regex Validation
    if (!excludeRegex.trim()) {
      setExcludeRegexError(null);
    } else {
      try {
        new RegExp(excludeRegex);
        setExcludeRegexError(null);
      } catch (e) {
        setExcludeRegexError("invalid");
      }
    }

    // Cache Validation
    const isCacheEnabled = newSettings.cacheInterval > 0;
    const cacheIsLarger =
      newSettings.cacheInterval > newSettings.refreshInterval;
    setIsCacheInvalid(
      refreshFieldsFilled &&
        cacheFieldsFilled &&
        isCacheEnabled &&
        cacheIsLarger,
    );
  }, [
    days,
    hours,
    minutes,
    cacheDays,
    cacheHours,
    cacheMinutes,
    releasesPerPage,
    parallelRepoFetches,
    newSettings.refreshInterval,
    newSettings.cacheInterval,
    includeRegex,
    excludeRegex,
  ]);

  // Auto-Save Effect
  // biome-ignore lint/correctness/useExhaustiveDependencies: router, toast, pathname, and t are stable functions from hooks
  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (!isOnline) {
      setSaveStatus("paused");
      return;
    }

    const hasEmptyFields = [
      days,
      hours,
      minutes,
      cacheDays,
      cacheHours,
      cacheMinutes,
      releasesPerPage,
      parallelRepoFetches,
      appriseMaxCharacters,
    ].some((val) => val === "");

    if (
      hasEmptyFields ||
      intervalError ||
      isCacheInvalid ||
      releasesPerPageError ||
      parallelRepoFetchesError ||
      includeRegexError ||
      excludeRegexError
    ) {
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("waiting");

    const handler = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const result = await updateSettingsAction(newSettings);

        if (result.success) {
          // On locale change: save flag and redirect immediately
          if (newSettings.locale !== currentSettings.locale) {
            sessionStorage.setItem("settingsSavedAfterLocaleChange", "true");
            router.push(pathname, { locale: newSettings.locale });
            return;
          }

          // Normal save: show success status and auto-hide after 3 seconds
          setSaveStatus("success");
          setTimeout(() => setSaveStatus("idle"), 3000);
        } else {
          setSaveStatus("error");
          // Toast only on error
          toast({
            title: result.message.title,
            description: result.message.description,
            variant: "destructive",
          });
        }
      } catch (err) {
        setSaveStatus("error");
        // Toast only on error
        toast({
          title: t("toast_error_title"),
          description: t("autosave_error"),
          variant: "destructive",
        });
      }
    }, 1500);

    return () => {
      clearTimeout(handler);
    };
  }, [
    newSettings,
    days,
    hours,
    minutes,
    cacheDays,
    cacheHours,
    cacheMinutes,
    releasesPerPage,
    parallelRepoFetches,
    intervalError,
    isCacheInvalid,
    releasesPerPageError,
    parallelRepoFetchesError,
    includeRegexError,
    excludeRegexError,
    appriseMaxCharacters,
    isOnline,
    currentSettings.locale,
  ]);

  const handleChannelChange = (channel: ReleaseChannel) => {
    const newChannels = channels.includes(channel)
      ? channels.filter((c) => c !== channel)
      : [...channels, channel];

    if (newChannels.length === 0) {
      toast({
        title: t("toast_error_title"),
        description: t("release_channel_error_at_least_one"),
        variant: "destructive",
      });
      return;
    }
    setChannels(newChannels);

    if (channel === "prerelease" && newChannels.includes("prerelease")) {
      setPreReleaseSubChannels(allPreReleaseTypes);
    }
  };

  const handlePreReleaseSubChannelChange = (
    subChannel: PreReleaseChannelType,
  ) => {
    setPreReleaseSubChannels((prev) =>
      prev.includes(subChannel)
        ? prev.filter((sc) => sc !== subChannel)
        : [...prev, subChannel],
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

  const handleDeleteAll = () => {
    startDeleteTransition(async () => {
      const result = await deleteAllRepositoriesAction();
      toast({
        title: result.message.title,
        description: result.message.description,
        variant: result.success ? "default" : "destructive",
      });
      if (result.success) {
        router.push("/");
      }
    });
  };

  return (
    <>
      <FloatingSaveIndicator status={saveStatus} />

      <div className="mx-auto max-w-2xl space-y-8">
        <Card>
          <CardHeader>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{t("time_format_label")}</Label>
              <RadioGroup
                value={timeFormat}
                onValueChange={(value: TimeFormat) => setTimeFormat(value)}
                className="flex items-center gap-4"
                disabled={saveStatus === "saving" || !isOnline}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="12h" id={ids.timeFormat12h} />
                  <Label htmlFor={ids.timeFormat12h}>
                    {t("time_format_12h")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="24h" id={ids.timeFormat24h} />
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
                disabled={saveStatus === "saving" || !isOnline}
              >
                <SelectTrigger
                  id={ids.languageSelect}
                  className="w-full sm:w-[180px]"
                >
                  <SelectValue placeholder={t("language_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("language_en")}</SelectItem>
                  <SelectItem value="de">{t("language_de")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-4 pt-2">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id={ids.showAcknowledge}
                  checked={showAcknowledge}
                  onCheckedChange={(checked) =>
                    setShowAcknowledge(Boolean(checked))
                  }
                  disabled={saveStatus === "saving" || !isOnline}
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
                  "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
                  showAcknowledge
                    ? "mt-4 max-h-96 opacity-100"
                    : "max-h-0 opacity-0",
                )}
              >
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id={ids.showMarkAsNew}
                    checked={showMarkAsNew}
                    onCheckedChange={(checked) =>
                      setShowMarkAsNew(Boolean(checked))
                    }
                    disabled={
                      saveStatus === "saving" || !showAcknowledge || !isOnline
                    }
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
            <div className="flex items-center space-x-2">
              <Checkbox
                id={ids.stable}
                checked={channels.includes("stable")}
                onCheckedChange={() => handleChannelChange("stable")}
                disabled={saveStatus === "saving" || !isOnline}
              />
              <Label
                htmlFor={ids.stable}
                className="font-normal cursor-pointer"
              >
                {t("release_channel_stable")}
              </Label>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={ids.prerelease}
                  checked={isPreReleaseChecked}
                  onCheckedChange={() => handleChannelChange("prerelease")}
                  disabled={saveStatus === "saving" || !isOnline}
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
                  "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
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
                      disabled={
                        !isPreReleaseChecked ||
                        saveStatus === "saving" ||
                        !isOnline
                      }
                    >
                      Select All
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
                      Deselect All
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
                    {allPreReleaseTypes.map((subType) => (
                      <div
                        key={subType}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`prerelease-${subType}`}
                          checked={preReleaseSubChannels.includes(subType)}
                          onCheckedChange={() =>
                            handlePreReleaseSubChannelChange(subType)
                          }
                          disabled={
                            !isPreReleaseChecked ||
                            saveStatus === "saving" ||
                            !isOnline
                          }
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

            <div className="flex items-center space-x-2">
              <Checkbox
                id={ids.draft}
                checked={channels.includes("draft")}
                onCheckedChange={() => handleChannelChange("draft")}
                disabled={saveStatus === "saving" || !isOnline}
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
                value={includeRegex}
                onChange={(e) => setIncludeRegex(e.target.value)}
                placeholder={t("regex_placeholder")}
                disabled={saveStatus === "saving" || !isOnline}
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
                value={excludeRegex}
                onChange={(e) => setExcludeRegex(e.target.value)}
                placeholder={t("regex_placeholder")}
                disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                    disabled={saveStatus === "saving" || !isOnline}
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
                disabled={saveStatus === "saving" || !isOnline}
                className={cn(
                  "mt-2 w-full sm:w-48",
                  !!releasesPerPageError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {releasesPerPageError === "too_low" ? (
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
                disabled={saveStatus === "saving" || !isOnline}
                className={cn(
                  "mt-2 w-full sm:w-48",
                  !!parallelRepoFetchesError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {parallelRepoFetchesError === "too_low" ? (
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
                disabled={
                  saveStatus === "saving" || !isAppriseConfigured || !isOnline
                }
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
                disabled={
                  saveStatus === "saving" || !isAppriseConfigured || !isOnline
                }
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
                type="text"
                value={appriseTags}
                onChange={(e) => setAppriseTags(e.target.value)}
                disabled={
                  saveStatus === "saving" || !isAppriseConfigured || !isOnline
                }
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

        <Card className="border-destructive/50">
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
                <Button
                  variant="destructive"
                  disabled={isDeleting || !isOnline}
                >
                  {isDeleting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
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
      </div>
    </>
  );
}

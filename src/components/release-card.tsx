"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  BellPlus,
  CheckSquare,
  ExternalLink,
  Loader2,
  Settings,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";

import {
  acknowledgeNewReleaseAction,
  markAsNewAction,
  removeRepositoryAction,
} from "@/app/actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { formatRepoIdForDisplay } from "@/lib/repo-id-display";
import {
  defaultSecurityHighlightCustomColor,
  isSecurityRelease,
  normalizeSecurityHighlightColorPreset,
  normalizeSecurityHighlightCustomColor,
} from "@/lib/security-release";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  EnrichedRelease,
  FetchError,
  SecurityHighlightColorPreset,
} from "@/types";
import { RepoSettingsDialog } from "./repo-settings-dialog";

function getErrorMessage(
  error: FetchError,
  t: (key: string) => string,
): string {
  switch (error.type) {
    case "rate_limit":
      return t("error_rate_limit");
    case "no_matching_releases":
      return t("error_no_matching_releases");
    case "repo_not_found":
      return t("error_repo_not_found");
    case "invalid_url":
      return t("error_invalid_url");
    case "no_releases_found":
      return t("error_no_releases_found");
    default:
      return t("error_generic_fetch");
  }
}

interface ReleaseCardProps {
  enrichedRelease: EnrichedRelease;
  settings: AppSettings;
  canMutate?: boolean;
}

type SecurityHighlightStyle = {
  cardClassName: string;
  badgeClassName: string;
  style?: React.CSSProperties;
};

const securityHighlightPresetStyles: Record<
  Exclude<SecurityHighlightColorPreset, "custom">,
  SecurityHighlightStyle
> = {
  yellow: {
    cardClassName:
      "border-yellow-500/70 ring-2 ring-yellow-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-yellow-500/70 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  },
  red: {
    cardClassName:
      "border-red-500/70 ring-2 ring-red-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-red-500/70 bg-red-500/15 text-red-700 dark:text-red-300",
  },
  orange: {
    cardClassName:
      "border-orange-500/70 ring-2 ring-orange-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-orange-500/70 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
  blue: {
    cardClassName:
      "border-blue-500/70 ring-2 ring-blue-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-blue-500/70 bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  purple: {
    cardClassName:
      "border-purple-500/70 ring-2 ring-purple-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-purple-500/70 bg-purple-500/15 text-purple-700 dark:text-purple-300",
  },
};

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeSecurityHighlightCustomColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getSecurityHighlightStyle(
  settings: AppSettings,
): SecurityHighlightStyle {
  const preset = normalizeSecurityHighlightColorPreset(
    settings.securityHighlightColorPreset,
  );

  if (preset !== "custom") {
    return securityHighlightPresetStyles[preset];
  }

  const color = normalizeSecurityHighlightCustomColor(
    settings.securityHighlightCustomColor ??
      defaultSecurityHighlightCustomColor,
  );
  const style = {
    "--security-highlight-border": hexToRgba(color, 0.7),
    "--security-highlight-ring": hexToRgba(color, 0.6),
    "--security-highlight-bg": hexToRgba(color, 0.15),
  } as React.CSSProperties;

  return {
    cardClassName:
      "border-[var(--security-highlight-border)] ring-2 ring-[var(--security-highlight-ring)] ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-[var(--security-highlight-border)] bg-[var(--security-highlight-bg)] text-foreground",
    style,
  };
}

const markdownSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes || {}),
    a: [...(defaultSchema.attributes?.a || []), "target", "rel"],
    img: [
      ...(defaultSchema.attributes?.img || []),
      "src",
      "alt",
      "title",
      "width",
      "height",
    ],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    src: ["http", "https"],
  },
};

export function ReleaseCard({
  enrichedRelease,
  settings,
  canMutate = true,
}: ReleaseCardProps) {
  const t = useTranslations("ReleaseCard");
  const tActions = useTranslations("Actions");
  const locale = useLocale();
  const { toast } = useToast();
  const { repoId, repoUrl, release, error, isNew, repoSettings } =
    enrichedRelease;
  const { isOnline } = useNetworkStatus();
  const displayRepoId = formatRepoIdForDisplay(repoId, {
    showProviderPrefix: settings.showProviderPrefixInRepoId ?? true,
    showProviderDomain: settings.showProviderDomainInRepoId ?? true,
  });

  const [isRemoving, startRemoveTransition] = React.useTransition();
  const [isAcknowledging, startAcknowledgeTransition] = React.useTransition();
  const [isMarkingAsNew, startMarkingAsNewTransition] = React.useTransition();
  const [timeAgo, setTimeAgo] = React.useState("");
  const [checkedAgo, setCheckedAgo] = React.useState("");
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const settingsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const prevIsSettingsOpenRef = React.useRef(false);
  const isTagLink = Boolean(release?.html_url?.includes("/src/tag/"));
  const isReleaseTimeUnknown = Boolean(release?.published_at_unknown);

  React.useEffect(() => {
    // When the settings dialog transitions from open -> closed, return focus to the trigger button.
    // Use a micro-delay to ensure the overlay has unmounted before focusing.
    if (prevIsSettingsOpenRef.current && !isSettingsOpen) {
      const btn = settingsButtonRef.current;
      setTimeout(() => btn?.focus(), 0);
    }
    prevIsSettingsOpenRef.current = isSettingsOpen;
  }, [isSettingsOpen]);

  React.useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const updateTimes = () => {
      // Update release time ago
      if (release?.created_at && !isReleaseTimeUnknown) {
        const dateToUse = release.published_at || release.created_at;
        setTimeAgo(
          formatDistanceToNowStrict(new Date(dateToUse), {
            addSuffix: true,
            locale: locale === "de" ? de : undefined,
          }),
        );
      } else {
        setTimeAgo("");
      }
      // Update checked time ago
      if (release?.fetched_at) {
        setCheckedAgo(
          formatDistanceToNowStrict(new Date(release.fetched_at), {
            addSuffix: true,
            locale: locale === "de" ? de : undefined,
          }),
        );
      }
    };

    updateTimes(); // Initial call
    intervalId = setInterval(updateTimes, 60000); // Update every minute

    // Clean up the interval when the component unmounts or dependencies change.
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [release, locale, isReleaseTimeUnknown]);
  const handleRemove = () => {
    startRemoveTransition(async () => {
      try {
        await removeRepositoryAction(repoId);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          variant: "destructive",
        });
      }
    });
  };

  const handleAcknowledge = () => {
    startAcknowledgeTransition(async () => {
      try {
        const result = await acknowledgeNewReleaseAction(repoId);
        if (result?.success === false) {
          toast({
            title: t("toast_error_title"),
            description: result.error,
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_acknowledge_error_generic"),
          variant: "destructive",
        });
      }
    });
  };

  const handleMarkAsNew = () => {
    startMarkingAsNewTransition(async () => {
      try {
        const result = await markAsNewAction(repoId);
        if (result?.success) {
          toast({
            title: t("toast_success_title"),
            description: t("toast_mark_as_new_success"),
          });
        } else {
          toast({
            title: t("toast_error_title"),
            description: result?.error ?? t("toast_mark_as_new_error_generic"),
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_mark_as_new_error_generic"),
          variant: "destructive",
        });
      }
    });
  };

  const repoHasCustomSettings =
    (repoSettings?.releaseChannels &&
      repoSettings.releaseChannels.length > 0) ||
    (repoSettings?.preReleaseSubChannels &&
      repoSettings.preReleaseSubChannels.length > 0) ||
    (repoSettings?.releasesPerPage !== null &&
      typeof repoSettings?.releasesPerPage === "number") ||
    (repoSettings?.refreshInterval !== null &&
      typeof repoSettings?.refreshInterval === "number") ||
    (repoSettings?.cacheInterval !== null &&
      typeof repoSettings?.cacheInterval === "number") ||
    repoSettings?.backgroundCheckCron ||
    repoSettings?.includeRegex ||
    repoSettings?.excludeRegex ||
    repoSettings?.appriseTags ||
    repoSettings?.appriseFormat;

  if (error && error.type !== "not_modified") {
    const errorMessage = getErrorMessage(error, tActions);
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={setIsSettingsOpen}
            repoId={repoId}
            currentRepoSettings={repoSettings}
            globalSettings={settings}
          />
        )}
        <Card className="border-destructive/50 bg-destructive/10 flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="break-words font-semibold text-xl text-red-400">
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {displayRepoId}
                  </a>
                </CardTitle>
                <CardDescription className="text-red-400/80">
                  {t("error_title")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {repoHasCustomSettings && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="border-accent text-accent"
                        >
                          {t("custom_settings_badge")}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("custom_settings_tooltip")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {canMutate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-red-400/80 hover:bg-red-400/10 hover:text-red-400"
                    onClick={() => setIsSettingsOpen(true)}
                    aria-label={t("settings_button_aria")}
                  >
                    <Settings className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grow pt-0 min-w-0">
            <div className="flex h-72 rounded-md border border-destructive/20 bg-background p-4">
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertTriangle className="size-4 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            </div>
          </CardContent>
          {canMutate && (
            <CardFooter className="pt-4 flex items-start">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isRemoving || !isOnline}
                    aria-disabled={!isOnline}
                  >
                    {isRemoving ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                    {t("remove_button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("confirm_dialog_title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.rich("confirm_dialog_description_long", {
                        bold: (chunks) => (
                          <span className="font-bold">{chunks}</span>
                        ),
                        repoId,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleRemove}
                      disabled={isRemoving || !isOnline}
                    >
                      {isRemoving ? <Loader2 className="animate-spin" /> : null}
                      {t("confirm_button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          )}
        </Card>
      </>
    );
  }

  if (!release) {
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={setIsSettingsOpen}
            repoId={repoId}
            currentRepoSettings={repoSettings}
            globalSettings={settings}
          />
        )}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-6 w-3/4" />
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:underline break-all"
                >
                  {displayRepoId}
                </a>
              </div>
              <div className="flex items-center gap-2">
                {repoHasCustomSettings && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="border-accent text-accent"
                        >
                          {t("custom_settings_badge")}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("custom_settings_tooltip")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {canMutate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    onClick={() => setIsSettingsOpen(true)}
                    ref={settingsButtonRef}
                    aria-label={t("settings_button_aria")}
                  >
                    <Settings className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <Skeleton className="h-4 w-24" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-72 w-full" />
          </CardContent>
          {canMutate && (
            <CardFooter className="justify-between pt-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isRemoving || !isOnline}
                    aria-disabled={!isOnline}
                  >
                    {isRemoving ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                    {t("remove_button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("confirm_dialog_title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.rich("confirm_dialog_description_long", {
                        bold: (chunks) => (
                          <span className="font-bold">{chunks}</span>
                        ),
                        repoId,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleRemove}
                      disabled={isRemoving || !isOnline}
                    >
                      {isRemoving ? <Loader2 className="animate-spin" /> : null}
                      {t("confirm_button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Skeleton className="h-8 w-32" />
            </CardFooter>
          )}
        </Card>
      </>
    );
  }

  const showAcknowledgeFeature = settings.showAcknowledge ?? true;
  const showMarkAsNewButton = settings.showMarkAsNew ?? true;
  const isNewSecurityRelease =
    Boolean(isNew) &&
    showAcknowledgeFeature &&
    isSecurityRelease(release, settings);
  const securityHighlightStyle = getSecurityHighlightStyle(settings);
  const shouldConfirmSecurityAcknowledge =
    isNewSecurityRelease && settings.confirmSecurityAcknowledge === true;

  return (
    <>
      {canMutate && (
        <RepoSettingsDialog
          isOpen={isSettingsOpen}
          setIsOpen={setIsSettingsOpen}
          repoId={repoId}
          currentRepoSettings={repoSettings}
          globalSettings={settings}
        />
      )}
      <Card
        className={cn(
          "flex flex-col transition-all",
          isNewSecurityRelease && securityHighlightStyle.cardClassName,
          isNew &&
            showAcknowledgeFeature &&
            !isNewSecurityRelease &&
            "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        style={isNewSecurityRelease ? securityHighlightStyle.style : undefined}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <CardTitle className="break-words font-semibold text-xl">
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {release.name || release.tag_name}
                </a>
              </CardTitle>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:underline break-all"
              >
                {displayRepoId}
              </a>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge variant="secondary" className="px-3 py-1 text-base">
                {release.tag_name}
              </Badge>
              <div className="flex items-center gap-2">
                {isNewSecurityRelease && (
                  <Badge
                    variant="outline"
                    className={securityHighlightStyle.badgeClassName}
                    style={securityHighlightStyle.style}
                  >
                    {t("security_release_badge")}
                  </Badge>
                )}
                {repoHasCustomSettings && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="border-accent text-accent"
                        >
                          {t("custom_settings_badge")}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("custom_settings_tooltip")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {canMutate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    onClick={() => setIsSettingsOpen(true)}
                    ref={settingsButtonRef}
                    aria-label={t("settings_button_aria")}
                  >
                    <Settings className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>
              {isReleaseTimeUnknown ? (
                t("released_time_unknown")
              ) : timeAgo ? (
                t("released_ago", { time: timeAgo })
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </span>
            {checkedAgo && (
              <>
                <span className="text-muted-foreground/50">|</span>
                <span className="text-muted-foreground">
                  {t("checked_ago", { time: checkedAgo })}
                </span>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="grow pt-0 min-w-0">
          {release.body && release.body.trim() !== "" ? (
            <div className="relative w-full max-h-72 overflow-hidden rounded-md border bg-background">
              <div className="prose prose-sm dark:prose-invert max-w-none h-72 overflow-auto break-words p-4 prose-img:rounded prose-img:max-w-full prose-img:h-auto">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkGemoji]}
                  rehypePlugins={[
                    rehypeRaw,
                    [rehypeSanitize, markdownSanitizeSchema],
                  ]}
                  skipHtml={false}
                  components={{
                    table: ({ node, ...props }) => (
                      <div className="overflow-x-auto">
                        <table {...props} className="table-fixed">
                          {props.children}
                        </table>
                      </div>
                    ),
                  }}
                >
                  {release.body}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-md border border-dashed">
              <p className="text-center text-sm text-muted-foreground">
                {t("no_release_notes")}
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 pt-4">
          {canMutate &&
            showAcknowledgeFeature &&
            (isNew ? (
              shouldConfirmSecurityAcknowledge ? (
                <AlertDialog>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            disabled={
                              isAcknowledging ||
                              isRemoving ||
                              isMarkingAsNew ||
                              !isOnline
                            }
                            aria-disabled={!isOnline}
                          >
                            {isAcknowledging ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CheckSquare />
                            )}
                            <span>{t("acknowledge_button")}</span>
                          </Button>
                        </AlertDialogTrigger>
                      </TooltipTrigger>
                      {!isOnline && (
                        <TooltipContent>
                          <p>{t("offline_tooltip")}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("security_acknowledge_confirm_title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t.rich("security_acknowledge_confirm_description", {
                          bold: (chunks) => (
                            <span className="font-bold">{chunks}</span>
                          ),
                          repoId,
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("cancel_button")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={handleAcknowledge}
                        disabled={isAcknowledging || !isOnline}
                      >
                        {isAcknowledging ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        {t("security_acknowledge_confirm_button")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        onClick={handleAcknowledge}
                        disabled={
                          isAcknowledging ||
                          isRemoving ||
                          isMarkingAsNew ||
                          !isOnline
                        }
                        aria-disabled={!isOnline}
                      >
                        {isAcknowledging ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckSquare />
                        )}
                        <span>{t("acknowledge_button")}</span>
                      </Button>
                    </TooltipTrigger>
                    {!isOnline && (
                      <TooltipContent>
                        <p>{t("offline_tooltip")}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )
            ) : (
              showMarkAsNewButton && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleMarkAsNew}
                        disabled={
                          isAcknowledging ||
                          isRemoving ||
                          isMarkingAsNew ||
                          !isOnline
                        }
                        aria-disabled={!isOnline}
                      >
                        {isMarkingAsNew ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <BellPlus />
                        )}
                        <span>{t("mark_as_new_button")}</span>
                      </Button>
                    </TooltipTrigger>
                    {!isOnline && (
                      <TooltipContent>
                        <p>{t("offline_tooltip")}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )
            ))}
          <div className="flex items-center justify-between">
            {canMutate ? (
              <AlertDialog>
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          disabled={isRemoving || isMarkingAsNew || !isOnline}
                          aria-disabled={!isOnline}
                        >
                          {isRemoving ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                          {t("remove_button")}
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    {!isOnline && (
                      <TooltipContent>
                        <p>{t("offline_tooltip")}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("confirm_dialog_title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.rich("confirm_dialog_description_long", {
                        bold: (chunks) => (
                          <span className="font-bold">{chunks}</span>
                        ),
                        repoId,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleRemove}
                      disabled={isRemoving || !isOnline}
                    >
                      {isRemoving ? <Loader2 className="animate-spin" /> : null}
                      {t("confirm_button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}

            <Button asChild variant="ghost" size="sm">
              <a
                href={release.html_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {isTagLink ? t("view_tag") : t("view_on_github")}{" "}
                <ExternalLink />
              </a>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </>
  );
}

ReleaseCard.Skeleton = function ReleaseCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <Skeleton className="h-4 w-24" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-72 w-full" />
      </CardContent>
      <CardFooter className="justify-between pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </CardFooter>
    </Card>
  );
};

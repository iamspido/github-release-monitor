"use client";

import {
  AlertTriangle,
  BellPlus,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  Loader2,
  Pin,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  acknowledgeNewReleaseAction,
  markAsNewAction,
  removeRepositoryAction,
} from "@/app/actions";
import { useReleaseRelativeTimes } from "@/components/release-card-hooks";
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
import { Badge, badgeVariants } from "@/components/ui/badge";
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
import { isSecurityRelease } from "@/lib/security-release";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { AppSettings, EnrichedRelease } from "@/types";
import {
  getReleaseCardHeading,
  getReleaseErrorMessage,
  getSecurityHighlightStyle,
  hasCustomRepoSettings,
} from "./release-card-helpers";
import { ReleaseNotesPreview } from "./release-notes-preview";
import { RepoSettingsDialog } from "./repo-settings-dialog";

interface ReleaseCardProps {
  enrichedRelease: EnrichedRelease;
  settings: AppSettings;
  availableRepositoryTags?: string[];
  repositoryTags?: string[];
  onRepositoryTagsChange?: (tags: string[]) => void;
  onPinnedChange?: (isPinned: boolean) => void;
  onSettingsOpenChange?: (open: boolean) => void;
  canMutate?: boolean;
  isAppriseConfigured?: boolean;
  variant?: "card" | "compact";
}

function CustomSettingsBadge({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("ReleaseCard");

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("border-accent text-accent", compact && "px-1.5")}
            tabIndex={0}
            aria-label={t("custom_settings_tooltip")}
          >
            {compact ? (
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            ) : (
              t("custom_settings_badge")
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("custom_settings_tooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PinnedRepositoryBadge({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("ReleaseCard");

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("text-muted-foreground", compact ? "px-1.5" : "px-2")}
            tabIndex={0}
            aria-label={t("pinned_tooltip")}
          >
            <Pin className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t("pinned_badge")}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("pinned_tooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CompactRepositoryIndicators({
  className,
  hasCustomSettings,
  isPinned,
}: {
  className?: string;
  hasCustomSettings: boolean;
  isPinned: boolean;
}) {
  if (!isPinned && !hasCustomSettings) return null;

  return (
    <div className={cn("items-center gap-1", className)}>
      {isPinned && <PinnedRepositoryBadge compact />}
      {hasCustomSettings && <CustomSettingsBadge compact />}
    </div>
  );
}

function RepositoryTagBadges({ tags }: { tags: readonly string[] }) {
  const t = useTranslations("ReleaseCard");
  if (tags.length === 0) return null;

  const visibleTags = tags.slice(0, 3);
  const remainingTags = tags.slice(3);

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {visibleTags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="max-w-36 truncate text-xs"
        >
          <bdi dir="ltr">{tag}</bdi>
        </Badge>
      ))}
      {remainingTags.length > 0 && (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  badgeVariants({ variant: "outline" }),
                  "cursor-help text-xs",
                )}
                aria-label={t("repository_tags_more_aria", {
                  count: remainingTags.length,
                  tags: remainingTags.join(", "),
                })}
              >
                +{remainingTags.length}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p dir="ltr">{remainingTags.join(", ")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function RepoSettingsTrigger({
  buttonRef,
  className,
  onOpen,
  repoName,
}: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
  onOpen: () => void;
  repoName?: string;
}) {
  const t = useTranslations("ReleaseCard");
  const label = repoName
    ? t("settings_button_aria_for_repo", { repo: repoName })
    : t("settings_button_aria");

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 text-muted-foreground", className)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      ref={buttonRef}
      aria-label={label}
      title={repoName ? label : undefined}
    >
      <Settings className="size-4" />
    </Button>
  );
}

function CompactExpandButton({
  controls,
  expanded,
  onToggle,
  repoName,
}: {
  controls: string;
  expanded: boolean;
  onToggle: () => void;
  repoName: string;
}) {
  const t = useTranslations("ReleaseCard");

  return (
    <Button
      type="button"
      variant="ghost"
      className="absolute inset-0 z-0 h-full w-full justify-start rounded-none px-3 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 active:bg-foreground/10"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={
        expanded
          ? t("collapse_details", { repo: repoName })
          : t("expand_details", { repo: repoName })
      }
    >
      <ChevronDown
        className={cn(
          "size-4 transition-transform motion-reduce:transition-none",
          expanded && "rotate-180",
        )}
      />
    </Button>
  );
}

function RemoveRepositoryButton({
  buttonClassName,
  buttonVariant = "ghost",
  disabled = false,
  iconOnly = false,
  isOnline,
  isRemoving,
  onRemove,
  repoId,
}: {
  buttonClassName?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  iconOnly?: boolean;
  isOnline: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  repoId: string;
}) {
  const t = useTranslations("ReleaseCard");
  const compactLabel = iconOnly
    ? t("remove_button_for_repo", { repo: repoId })
    : undefined;

  const triggerButton = (
    <Button
      data-repository-id={repoId}
      data-testid="remove-repository"
      variant={buttonVariant}
      size={iconOnly ? "icon" : "sm"}
      className={cn(iconOnly && "size-8", buttonClassName)}
      disabled={disabled || isRemoving || !isOnline}
      aria-disabled={!isOnline}
      aria-label={compactLabel}
      title={compactLabel}
      onClick={(event) => event.stopPropagation()}
    >
      {isRemoving ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {!iconOnly && t("remove_button")}
    </Button>
  );

  return (
    <AlertDialog>
      {buttonVariant === "ghost" ? (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>{triggerButton}</AlertDialogTrigger>
            </TooltipTrigger>
            {!isOnline && (
              <TooltipContent>
                <p>{t("offline_tooltip")}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      ) : (
        <AlertDialogTrigger asChild>{triggerButton}</AlertDialogTrigger>
      )}
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirm_dialog_title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich("confirm_dialog_description_long", {
              bold: (chunks) => <span className="font-bold">{chunks}</span>,
              repoId,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-remove-repository"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onRemove}
            disabled={isRemoving || !isOnline}
          >
            {isRemoving ? <Loader2 className="animate-spin" /> : null}
            {t("confirm_button")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReleaseActions({
  canMutate,
  compact = false,
  compactSettingsAction,
  isAcknowledging,
  isMarkingAsNew,
  isNew,
  isOnline,
  isRemoving,
  isTagLink,
  onAcknowledge,
  onMarkAsNew,
  onRemove,
  releaseUrl,
  repoId,
  shouldConfirmSecurityAcknowledge,
  showAcknowledgeFeature,
  showMarkAsNewButton,
}: {
  canMutate: boolean;
  compact?: boolean;
  compactSettingsAction?: React.ReactNode;
  isAcknowledging: boolean;
  isMarkingAsNew: boolean;
  isNew?: boolean;
  isOnline: boolean;
  isRemoving: boolean;
  isTagLink: boolean;
  onAcknowledge: () => void;
  onMarkAsNew: () => void;
  onRemove: () => void;
  releaseUrl: string;
  repoId: string;
  shouldConfirmSecurityAcknowledge: boolean;
  showAcknowledgeFeature: boolean;
  showMarkAsNewButton: boolean;
}) {
  const t = useTranslations("ReleaseCard");
  const actionDisabled =
    isAcknowledging || isRemoving || isMarkingAsNew || !isOnline;
  const acknowledgeLabel = compact
    ? t("acknowledge_button_for_repo", { repo: repoId })
    : undefined;
  const markAsNewLabel = compact
    ? t("mark_as_new_button_for_repo", { repo: repoId })
    : undefined;
  const releaseLinkLabel = compact
    ? isTagLink
      ? t("view_tag_for_repo", { repo: repoId })
      : t("view_release_for_repo", { repo: repoId })
    : undefined;

  return (
    <div className={compact ? "flex items-center gap-1" : "contents"}>
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
                        size={compact ? "icon" : "sm"}
                        className={compact ? "size-8" : undefined}
                        disabled={actionDisabled}
                        aria-disabled={!isOnline}
                        aria-label={acknowledgeLabel}
                        title={acknowledgeLabel}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {isAcknowledging ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckSquare />
                        )}
                        {!compact && <span>{t("acknowledge_button")}</span>}
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
              <AlertDialogContent onClick={(event) => event.stopPropagation()}>
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
                  <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onAcknowledge}
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
                    size={compact ? "icon" : "sm"}
                    className={compact ? "size-8" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAcknowledge();
                    }}
                    disabled={actionDisabled}
                    aria-disabled={!isOnline}
                    aria-label={acknowledgeLabel}
                    title={acknowledgeLabel}
                  >
                    {isAcknowledging ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CheckSquare />
                    )}
                    {!compact && <span>{t("acknowledge_button")}</span>}
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
                    size={compact ? "icon" : "sm"}
                    className={compact ? "size-8" : undefined}
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMarkAsNew();
                    }}
                    disabled={actionDisabled}
                    aria-disabled={!isOnline}
                    aria-label={markAsNewLabel}
                    title={markAsNewLabel}
                  >
                    {isMarkingAsNew ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <BellPlus />
                    )}
                    {!compact && <span>{t("mark_as_new_button")}</span>}
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
      {compact && compactSettingsAction}
      <div
        className={
          compact
            ? "flex items-center gap-1"
            : "flex items-center justify-between"
        }
      >
        {!compact && canMutate ? (
          <RemoveRepositoryButton
            buttonClassName="text-muted-foreground"
            disabled={isMarkingAsNew}
            iconOnly={compact}
            isOnline={isOnline}
            isRemoving={isRemoving}
            onRemove={onRemove}
            repoId={repoId}
          />
        ) : !compact ? (
          <span />
        ) : null}

        <Button
          asChild
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={compact ? "size-8" : undefined}
        >
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            aria-label={releaseLinkLabel}
            title={releaseLinkLabel}
          >
            {!compact && (isTagLink ? t("view_tag") : t("view_on_github"))}{" "}
            <ExternalLink />
          </a>
        </Button>
        {compact && canMutate && (
          <RemoveRepositoryButton
            buttonClassName="text-muted-foreground"
            disabled={isMarkingAsNew}
            iconOnly
            isOnline={isOnline}
            isRemoving={isRemoving}
            onRemove={onRemove}
            repoId={repoId}
          />
        )}
      </div>
    </div>
  );
}

export function ReleaseCard({
  enrichedRelease,
  settings,
  availableRepositoryTags = [],
  repositoryTags = [],
  onRepositoryTagsChange,
  onPinnedChange,
  onSettingsOpenChange,
  canMutate = true,
  isAppriseConfigured = false,
  variant = "card",
}: ReleaseCardProps) {
  const t = useTranslations("ReleaseCard");
  const tActions = useTranslations("Actions");
  const { toast } = useToast();
  const { repoId, repoUrl, release, error, isNew, repoSettings } =
    enrichedRelease;
  const { isOnline } = useNetworkStatus();
  const displayRepoId = formatRepoIdForDisplay(repoId, {
    showProviderPrefix: settings.showProviderPrefixInRepoId ?? true,
    showProviderDomain: settings.showProviderDomainInRepoId ?? true,
  });
  const [savedDisplayName, setSavedDisplayName] = React.useState(
    repoSettings?.displayName,
  );
  React.useEffect(() => {
    setSavedDisplayName(repoSettings?.displayName);
  }, [repoSettings?.displayName]);
  const effectiveRepoSettings = React.useMemo(
    () => ({ ...repoSettings, displayName: savedDisplayName }),
    [repoSettings, savedDisplayName],
  );
  const customDisplayName = savedDisplayName?.trim();
  const isPinned = effectiveRepoSettings.isPinned === true;

  const [isRemoving, startRemoveTransition] = React.useTransition();
  const [isAcknowledging, startAcknowledgeTransition] = React.useTransition();
  const [isMarkingAsNew, startMarkingAsNewTransition] = React.useTransition();
  const { checkedAgo, isReleaseTimeUnknown, timeAgo } =
    useReleaseRelativeTimes(release);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const compactDetailsId = React.useId();
  const compactHeadingId = React.useId();
  const settingsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const prevIsSettingsOpenRef = React.useRef(false);
  const reportedSettingsOpenRef = React.useRef(isSettingsOpen);
  const settingsOpenRef = React.useRef(isSettingsOpen);
  const onSettingsOpenChangeRef = React.useRef(onSettingsOpenChange);
  const isTagLink = Boolean(release?.html_url?.includes("/src/tag/"));

  const handleSettingsOpenChange = (open: boolean) => {
    setIsSettingsOpen(open);
  };

  React.useEffect(() => {
    onSettingsOpenChangeRef.current = onSettingsOpenChange;
  }, [onSettingsOpenChange]);

  React.useEffect(() => {
    settingsOpenRef.current = isSettingsOpen;
    if (reportedSettingsOpenRef.current === isSettingsOpen) return;

    reportedSettingsOpenRef.current = isSettingsOpen;
    onSettingsOpenChangeRef.current?.(isSettingsOpen);
  }, [isSettingsOpen]);

  React.useEffect(
    () => () => {
      if (settingsOpenRef.current) {
        onSettingsOpenChangeRef.current?.(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    // When the settings dialog transitions from open -> closed, return focus to the trigger button.
    // Use a micro-delay to ensure the overlay has unmounted before focusing.
    let focusTimeout: ReturnType<typeof setTimeout> | undefined;
    if (prevIsSettingsOpenRef.current && !isSettingsOpen) {
      const btn = settingsButtonRef.current;
      focusTimeout = setTimeout(() => btn?.focus(), 0);
    }
    prevIsSettingsOpenRef.current = isSettingsOpen;

    return () => {
      if (focusTimeout) clearTimeout(focusTimeout);
    };
  }, [isSettingsOpen]);
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

  const repoHasCustomSettings = hasCustomRepoSettings(effectiveRepoSettings);

  if (error && error.type !== "not_modified") {
    const errorMessage = getReleaseErrorMessage(error, tActions);
    if (variant === "compact") {
      return (
        <>
          {canMutate && (
            <RepoSettingsDialog
              isOpen={isSettingsOpen}
              setIsOpen={handleSettingsOpenChange}
              repoId={repoId}
              currentRepoSettings={effectiveRepoSettings}
              onDisplayNameChange={setSavedDisplayName}
              availableRepositoryTags={availableRepositoryTags}
              currentRepositoryTags={repositoryTags}
              onRepositoryTagsChange={onRepositoryTagsChange}
              onPinnedChange={onPinnedChange}
              globalSettings={settings}
              isAppriseConfigured={isAppriseConfigured}
            />
          )}
          <article
            aria-labelledby={compactHeadingId}
            className={cn(
              "isolate overflow-hidden rounded-lg border border-destructive/50 bg-destructive/10",
              isExpanded && "col-span-full",
            )}
          >
            <div className="relative flex min-h-14 items-center gap-1 px-2 py-1.5">
              <CompactExpandButton
                controls={compactDetailsId}
                expanded={isExpanded}
                onToggle={() => setIsExpanded((current) => !current)}
                repoName={displayRepoId}
              />
              <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2 ps-11 pe-1">
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <h3
                    id={compactHeadingId}
                    className="w-fit max-w-full truncate font-semibold text-destructive"
                  >
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pointer-events-auto relative z-10 block max-w-full truncate hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <bdi dir={customDisplayName ? "auto" : "ltr"}>
                        {customDisplayName || displayRepoId}
                      </bdi>
                    </a>
                  </h3>
                  {customDisplayName && (
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pointer-events-auto relative z-10 block w-fit max-w-full truncate text-xs text-destructive/80 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <bdi dir="ltr">{displayRepoId}</bdi>
                    </a>
                  )}
                </div>
              </div>
              <div className="pointer-events-auto relative z-10 flex shrink-0 items-center justify-end gap-1">
                <CompactRepositoryIndicators
                  className="hidden sm:flex"
                  hasCustomSettings={repoHasCustomSettings}
                  isPinned={isPinned}
                />
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onOpen={() => handleSettingsOpenChange(true)}
                    repoName={repoId}
                  />
                )}
                {canMutate && (
                  <RemoveRepositoryButton
                    buttonClassName="text-destructive"
                    iconOnly
                    isOnline={isOnline}
                    isRemoving={isRemoving}
                    onRemove={handleRemove}
                    repoId={repoId}
                  />
                )}
              </div>
            </div>
            <div
              id={compactDetailsId}
              hidden={!isExpanded}
              className="space-y-4 border-t border-destructive/20 p-4"
            >
              {isExpanded && (
                <>
                  <CompactRepositoryIndicators
                    className="flex sm:hidden"
                    hasCustomSettings={repoHasCustomSettings}
                    isPinned={isPinned}
                  />
                  <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-background p-4 text-sm text-destructive">
                    <AlertTriangle className="size-4 shrink-0" />
                    <p>{errorMessage}</p>
                  </div>
                  <RepositoryTagBadges tags={repositoryTags} />
                </>
              )}
            </div>
          </article>
        </>
      );
    }
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={handleSettingsOpenChange}
            repoId={repoId}
            currentRepoSettings={effectiveRepoSettings}
            onDisplayNameChange={setSavedDisplayName}
            availableRepositoryTags={availableRepositoryTags}
            currentRepositoryTags={repositoryTags}
            onRepositoryTagsChange={onRepositoryTagsChange}
            onPinnedChange={onPinnedChange}
            globalSettings={settings}
            isAppriseConfigured={isAppriseConfigured}
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
                    <bdi dir={customDisplayName ? "auto" : "ltr"}>
                      {customDisplayName || displayRepoId}
                    </bdi>
                  </a>
                </CardTitle>
                {customDisplayName && (
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-red-400/80 hover:underline break-all"
                  >
                    <bdi dir="ltr">{displayRepoId}</bdi>
                  </a>
                )}
                <CardDescription className="text-red-400/80">
                  {t("error_title")}
                </CardDescription>
                <RepositoryTagBadges tags={repositoryTags} />
              </div>
              <div className="flex items-center gap-2">
                {isPinned && <PinnedRepositoryBadge />}
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    className="size-8 shrink-0 text-red-400/80 hover:bg-red-400/10 hover:text-red-400"
                    onOpen={() => handleSettingsOpenChange(true)}
                  />
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
              <RemoveRepositoryButton
                buttonVariant="destructive"
                isOnline={isOnline}
                isRemoving={isRemoving}
                onRemove={handleRemove}
                repoId={repoId}
              />
            </CardFooter>
          )}
        </Card>
      </>
    );
  }

  if (!release) {
    if (variant === "compact") {
      return (
        <>
          {canMutate && (
            <RepoSettingsDialog
              isOpen={isSettingsOpen}
              setIsOpen={handleSettingsOpenChange}
              repoId={repoId}
              currentRepoSettings={effectiveRepoSettings}
              onDisplayNameChange={setSavedDisplayName}
              availableRepositoryTags={availableRepositoryTags}
              currentRepositoryTags={repositoryTags}
              onRepositoryTagsChange={onRepositoryTagsChange}
              onPinnedChange={onPinnedChange}
              globalSettings={settings}
              isAppriseConfigured={isAppriseConfigured}
            />
          )}
          <article
            aria-labelledby={compactHeadingId}
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1.5"
          >
            <Skeleton className="size-8 rounded-md" />
            <div className="min-w-0 space-y-1.5">
              {customDisplayName ? (
                <h3
                  id={compactHeadingId}
                  className="w-fit max-w-full truncate font-semibold"
                >
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-full truncate hover:underline"
                  >
                    <bdi dir="auto">{customDisplayName}</bdi>
                  </a>
                </h3>
              ) : (
                <>
                  <h3 id={compactHeadingId} className="sr-only">
                    <bdi dir="ltr">{displayRepoId}</bdi>
                  </h3>
                  <Skeleton className="h-5 w-48 max-w-full" />
                </>
              )}
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-fit max-w-full truncate text-xs text-muted-foreground hover:underline"
              >
                <bdi dir="ltr">{displayRepoId}</bdi>
              </a>
            </div>
            <div className="flex items-center justify-end gap-1">
              <CompactRepositoryIndicators
                className="flex"
                hasCustomSettings={repoHasCustomSettings}
                isPinned={isPinned}
              />
              {canMutate && (
                <>
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    onOpen={() => handleSettingsOpenChange(true)}
                    repoName={repoId}
                  />
                  <RemoveRepositoryButton
                    buttonClassName="text-muted-foreground"
                    iconOnly
                    isOnline={isOnline}
                    isRemoving={isRemoving}
                    onRemove={handleRemove}
                    repoId={repoId}
                  />
                </>
              )}
            </div>
          </article>
        </>
      );
    }
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={handleSettingsOpenChange}
            repoId={repoId}
            currentRepoSettings={effectiveRepoSettings}
            onDisplayNameChange={setSavedDisplayName}
            availableRepositoryTags={availableRepositoryTags}
            currentRepositoryTags={repositoryTags}
            onRepositoryTagsChange={onRepositoryTagsChange}
            onPinnedChange={onPinnedChange}
            globalSettings={settings}
            isAppriseConfigured={isAppriseConfigured}
          />
        )}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {customDisplayName ? (
                  <CardTitle className="break-words font-semibold text-xl">
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      <bdi dir="auto">{customDisplayName}</bdi>
                    </a>
                  </CardTitle>
                ) : (
                  <Skeleton className="h-6 w-3/4" />
                )}
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:underline break-all"
                >
                  <bdi dir="ltr">{displayRepoId}</bdi>
                </a>
                <RepositoryTagBadges tags={repositoryTags} />
              </div>
              <div className="flex items-center gap-2">
                {isPinned && <PinnedRepositoryBadge />}
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    onOpen={() => handleSettingsOpenChange(true)}
                  />
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
              <RemoveRepositoryButton
                buttonVariant="destructive"
                isOnline={isOnline}
                isRemoving={isRemoving}
                onRemove={handleRemove}
                repoId={repoId}
              />
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
  const cardHeading = getReleaseCardHeading({
    displayName: savedDisplayName,
    releaseName: release.name,
    releaseTag: release.tag_name,
    repoId,
  });

  if (variant === "compact") {
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={handleSettingsOpenChange}
            repoId={repoId}
            currentRepoSettings={effectiveRepoSettings}
            onDisplayNameChange={setSavedDisplayName}
            availableRepositoryTags={availableRepositoryTags}
            currentRepositoryTags={repositoryTags}
            onRepositoryTagsChange={onRepositoryTagsChange}
            onPinnedChange={onPinnedChange}
            globalSettings={settings}
            isAppriseConfigured={isAppriseConfigured}
          />
        )}
        <article
          aria-labelledby={compactHeadingId}
          className={cn(
            "isolate overflow-hidden rounded-lg border bg-card text-card-foreground transition-all",
            isExpanded && "col-span-full",
            isNewSecurityRelease && securityHighlightStyle.cardClassName,
            isNew &&
              showAcknowledgeFeature &&
              !isNewSecurityRelease &&
              "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          style={
            isNewSecurityRelease ? securityHighlightStyle.style : undefined
          }
        >
          <div className="relative flex min-h-14 items-center gap-1 px-2 py-1.5">
            <CompactExpandButton
              controls={compactDetailsId}
              expanded={isExpanded}
              onToggle={() => setIsExpanded((current) => !current)}
              repoName={displayRepoId}
            />
            <div className="pointer-events-none min-w-0 flex-1 ps-11 pe-1">
              <h3
                id={compactHeadingId}
                className="w-fit max-w-full truncate font-semibold"
              >
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto relative z-10 block w-fit max-w-full truncate hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  <bdi dir="auto">{cardHeading}</bdi>
                  {isNew && showAcknowledgeFeature && (
                    <span className="sr-only"> – {t("new_release_badge")}</span>
                  )}
                  {isNewSecurityRelease && (
                    <span className="sr-only">
                      {" "}
                      – {t("security_release_badge")}
                    </span>
                  )}
                </a>
              </h3>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-events-auto relative z-10 block w-fit max-w-full truncate text-xs text-muted-foreground hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                <bdi dir="ltr">{displayRepoId}</bdi>
              </a>
            </div>
            <Badge
              variant="secondary"
              className="pointer-events-none hidden max-w-24 shrink-0 truncate sm:inline-flex"
              title={release.tag_name}
            >
              <bdi dir="ltr">{release.tag_name}</bdi>
            </Badge>
            <div className="pointer-events-auto relative z-10 flex shrink-0 items-center justify-end gap-1">
              <CompactRepositoryIndicators
                className="hidden sm:flex"
                hasCustomSettings={repoHasCustomSettings}
                isPinned={isPinned}
              />
              <ReleaseActions
                canMutate={canMutate}
                compact
                compactSettingsAction={
                  canMutate ? (
                    <RepoSettingsTrigger
                      buttonRef={settingsButtonRef}
                      onOpen={() => handleSettingsOpenChange(true)}
                      repoName={repoId}
                    />
                  ) : null
                }
                isAcknowledging={isAcknowledging}
                isMarkingAsNew={isMarkingAsNew}
                isNew={isNew}
                isOnline={isOnline}
                isRemoving={isRemoving}
                isTagLink={isTagLink}
                onAcknowledge={handleAcknowledge}
                onMarkAsNew={handleMarkAsNew}
                onRemove={handleRemove}
                releaseUrl={release.html_url}
                repoId={repoId}
                shouldConfirmSecurityAcknowledge={
                  shouldConfirmSecurityAcknowledge
                }
                showAcknowledgeFeature={showAcknowledgeFeature}
                showMarkAsNewButton={showMarkAsNewButton}
              />
            </div>
          </div>
          <div
            id={compactDetailsId}
            hidden={!isExpanded}
            className="space-y-4 border-t p-4"
          >
            {isExpanded && (
              <>
                <CompactRepositoryIndicators
                  className="flex sm:hidden"
                  hasCustomSettings={repoHasCustomSettings}
                  isPinned={isPinned}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="max-w-full truncate">
                    <bdi dir="ltr">{release.tag_name}</bdi>
                  </Badge>
                  <div>
                    {isReleaseTimeUnknown ? (
                      t("released_time_unknown")
                    ) : timeAgo ? (
                      t("released_ago", { time: timeAgo })
                    ) : (
                      <Skeleton className="h-4 w-24" />
                    )}
                  </div>
                  {checkedAgo && (
                    <span>{t("checked_ago", { time: checkedAgo })}</span>
                  )}
                </div>
                <RepositoryTagBadges tags={repositoryTags} />
                <ReleaseNotesPreview
                  body={release.body}
                  commitLinks={release.commit_links}
                />
              </>
            )}
          </div>
        </article>
      </>
    );
  }

  return (
    <>
      {canMutate && (
        <RepoSettingsDialog
          isOpen={isSettingsOpen}
          setIsOpen={handleSettingsOpenChange}
          repoId={repoId}
          currentRepoSettings={effectiveRepoSettings}
          onDisplayNameChange={setSavedDisplayName}
          availableRepositoryTags={availableRepositoryTags}
          currentRepositoryTags={repositoryTags}
          onRepositoryTagsChange={onRepositoryTagsChange}
          onPinnedChange={onPinnedChange}
          globalSettings={settings}
          isAppriseConfigured={isAppriseConfigured}
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
                  <bdi dir="auto">{cardHeading}</bdi>
                </a>
              </CardTitle>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:underline break-all"
              >
                <bdi dir="ltr">{displayRepoId}</bdi>
              </a>
              <RepositoryTagBadges tags={repositoryTags} />
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge variant="secondary" className="px-3 py-1 text-base">
                <bdi dir="ltr">{release.tag_name}</bdi>
              </Badge>
              <div className="flex items-center gap-2">
                {isPinned && <PinnedRepositoryBadge />}
                {isNewSecurityRelease && (
                  <Badge
                    variant="outline"
                    className={securityHighlightStyle.badgeClassName}
                    style={securityHighlightStyle.style}
                  >
                    {t("security_release_badge")}
                  </Badge>
                )}
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    onOpen={() => handleSettingsOpenChange(true)}
                  />
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
          <ReleaseNotesPreview
            body={release.body}
            commitLinks={release.commit_links}
          />
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 pt-4">
          <ReleaseActions
            canMutate={canMutate}
            isAcknowledging={isAcknowledging}
            isMarkingAsNew={isMarkingAsNew}
            isNew={isNew}
            isOnline={isOnline}
            isRemoving={isRemoving}
            isTagLink={isTagLink}
            onAcknowledge={handleAcknowledge}
            onMarkAsNew={handleMarkAsNew}
            onRemove={handleRemove}
            releaseUrl={release.html_url}
            repoId={repoId}
            shouldConfirmSecurityAcknowledge={shouldConfirmSecurityAcknowledge}
            showAcknowledgeFeature={showAcknowledgeFeature}
            showMarkAsNewButton={showMarkAsNewButton}
          />
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

"use client";

import {
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
import type * as React from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function CustomSettingsBadge({
  compact = false,
}: {
  compact?: boolean;
}) {
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

export function PinnedRepositoryBadge({
  compact = false,
}: {
  compact?: boolean;
}) {
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

export function CompactRepositoryIndicators({
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

export function RepositoryTagBadges({ tags }: { tags: readonly string[] }) {
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

export function RepoSettingsTrigger({
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

export function CompactExpandButton({
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

export function RemoveRepositoryButton({
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

export function ReleaseActions({
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

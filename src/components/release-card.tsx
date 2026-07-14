"use client";

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
import { isSecurityRelease } from "@/lib/security-release";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { AppSettings, EnrichedRelease } from "@/types";
import {
  getReleaseErrorMessage,
  getSecurityHighlightStyle,
  hasCustomRepoSettings,
} from "./release-card-helpers";
import { ReleaseNotesPreview } from "./release-notes-preview";
import { RepoSettingsDialog } from "./repo-settings-dialog";

interface ReleaseCardProps {
  enrichedRelease: EnrichedRelease;
  settings: AppSettings;
  canMutate?: boolean;
  isAppriseConfigured?: boolean;
}

function CustomSettingsBadge() {
  const t = useTranslations("ReleaseCard");

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="border-accent text-accent">
            {t("custom_settings_badge")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("custom_settings_tooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RepoSettingsTrigger({
  buttonRef,
  className,
  onOpen,
}: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
  onOpen: () => void;
}) {
  const t = useTranslations("ReleaseCard");

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 text-muted-foreground", className)}
      onClick={onOpen}
      ref={buttonRef}
      aria-label={t("settings_button_aria")}
    >
      <Settings className="size-4" />
    </Button>
  );
}

function RemoveRepositoryButton({
  buttonClassName,
  buttonVariant = "ghost",
  disabled = false,
  isOnline,
  isRemoving,
  onRemove,
  repoId,
}: {
  buttonClassName?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  isOnline: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  repoId: string;
}) {
  const t = useTranslations("ReleaseCard");

  const triggerButton = (
    <Button
      variant={buttonVariant}
      size="sm"
      className={buttonClassName}
      disabled={disabled || isRemoving || !isOnline}
      aria-disabled={!isOnline}
    >
      {isRemoving ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {t("remove_button")}
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
      <AlertDialogContent>
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

export function ReleaseCard({
  enrichedRelease,
  settings,
  canMutate = true,
  isAppriseConfigured = false,
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
  const { checkedAgo, isReleaseTimeUnknown, timeAgo } = useReleaseRelativeTimes(
    release,
    locale,
  );
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const settingsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const prevIsSettingsOpenRef = React.useRef(false);
  const isTagLink = Boolean(release?.html_url?.includes("/src/tag/"));

  React.useEffect(() => {
    // When the settings dialog transitions from open -> closed, return focus to the trigger button.
    // Use a micro-delay to ensure the overlay has unmounted before focusing.
    if (prevIsSettingsOpenRef.current && !isSettingsOpen) {
      const btn = settingsButtonRef.current;
      setTimeout(() => btn?.focus(), 0);
    }
    prevIsSettingsOpenRef.current = isSettingsOpen;
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

  const repoHasCustomSettings = hasCustomRepoSettings(repoSettings);

  if (error && error.type !== "not_modified") {
    const errorMessage = getReleaseErrorMessage(error, tActions);
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={setIsSettingsOpen}
            repoId={repoId}
            currentRepoSettings={repoSettings}
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
                    {displayRepoId}
                  </a>
                </CardTitle>
                <CardDescription className="text-red-400/80">
                  {t("error_title")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    className="size-8 shrink-0 text-red-400/80 hover:bg-red-400/10 hover:text-red-400"
                    onOpen={() => setIsSettingsOpen(true)}
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
    return (
      <>
        {canMutate && (
          <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={setIsSettingsOpen}
            repoId={repoId}
            currentRepoSettings={repoSettings}
            globalSettings={settings}
            isAppriseConfigured={isAppriseConfigured}
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
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    onOpen={() => setIsSettingsOpen(true)}
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

  return (
    <>
      {canMutate && (
        <RepoSettingsDialog
          isOpen={isSettingsOpen}
          setIsOpen={setIsSettingsOpen}
          repoId={repoId}
          currentRepoSettings={repoSettings}
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
                {repoHasCustomSettings && <CustomSettingsBadge />}
                {canMutate && (
                  <RepoSettingsTrigger
                    buttonRef={settingsButtonRef}
                    onOpen={() => setIsSettingsOpen(true)}
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
          <ReleaseNotesPreview body={release.body} />
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
              <RemoveRepositoryButton
                buttonClassName="text-muted-foreground"
                disabled={isMarkingAsNew}
                isOnline={isOnline}
                isRemoving={isRemoving}
                onRemove={handleRemove}
                repoId={repoId}
              />
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

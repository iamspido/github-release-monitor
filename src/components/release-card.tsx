"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  acknowledgeNewReleaseAction,
  markAsNewAction,
  removeRepositoryAction,
} from "@/app/actions";
import {
  CompactExpandButton,
  CompactRepositoryIndicators,
  CustomSettingsBadge,
  PinnedRepositoryBadge,
  ReleaseActions,
  RemoveRepositoryButton,
  RepoSettingsTrigger,
  RepositoryTagBadges,
} from "@/components/release-card-actions";
import { useReleaseRelativeTimes } from "@/components/release-card-hooks";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
  WifiOff,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { createPortal } from "react-dom";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AutosaveStatus } from "@/hooks/use-autosave-controller";
import { cn } from "@/lib/utils";
import { RepoSettingsAutomationSection } from "./repo-settings-automation-section";
import { RepoSettingsDeliverySections } from "./repo-settings-delivery-sections";
import { RepoSettingsDisplayTagsSections } from "./repo-settings-display-tags-sections";
import { RepoSettingsFilterSections } from "./repo-settings-filter-sections";
import {
  type RepoSettingsDialogProps,
  useRepoSettingsDialogController,
} from "./use-repo-settings-dialog-controller";

function SaveStatusIndicator({ status }: { status: AutosaveStatus }) {
  const t = useTranslations("RepoSettingsDialog");
  const tLong = useTranslations("SettingsForm");

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
      data-status={status}
      data-testid="autosave-status"
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

export function RepoSettingsDialog({
  isOpen,
  setIsOpen,
  repoId,
  availableRepositoryTags = [],
  currentRepositoryTags = [],
  onRepositoryTagsChange,
  onPinnedChange,
  onDisplayNameChange,
  currentRepoSettings,
  globalSettings,
  isAppriseConfigured = false,
}: RepoSettingsDialogProps) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const controller = useRepoSettingsDialogController({
    isOpen,
    setIsOpen,
    repoId,
    availableRepositoryTags,
    currentRepositoryTags,
    onRepositoryTagsChange,
    onPinnedChange,
    onDisplayNameChange,
    currentRepoSettings,
    globalSettings,
  });
  const {
    closeValidationBlocked,
    displayRepoId,
    handleAutosaveBlur,
    handleAutosaveKeyDown,
    handleOpenChange,
    handleResetAll,
    isOnline,
    isRtl,
    isUsingAllGlobalSettings,
    repositoryTagDragPreview,
    repositoryTagDragPreviewRef,
    repositoryTagDragSize,
    repositoryTags,
    saveStatus,
  } = controller;
  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-lg"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onBlur={handleAutosaveBlur}
          onKeyDown={handleAutosaveKeyDown}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t.rich("description_flexible", {
                repoId: () => (
                  <bdi dir="ltr" className="font-semibold text-foreground">
                    {displayRepoId}
                  </bdi>
                ),
              })}
            </DialogDescription>
          </DialogHeader>

          {!isOnline && (
            <div className="mb-3 mt-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-300">
              {tGlobal("offline_notice")}
            </div>
          )}

          {closeValidationBlocked && (
            <div
              className="mb-3 mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {t("close_validation_error")}
            </div>
          )}

          <div className="space-y-6 pt-2 max-h-[60vh] overflow-y-auto pe-2 -me-4 pb-4">
            <RepoSettingsDisplayTagsSections
              controller={controller}
              globalSettings={globalSettings}
              repoId={repoId}
            />

            <RepoSettingsFilterSections
              controller={controller}
              globalSettings={globalSettings}
            />

            <RepoSettingsAutomationSection
              controller={controller}
              globalSettings={globalSettings}
            />

            <RepoSettingsDeliverySections
              controller={controller}
              globalSettings={globalSettings}
              isAppriseConfigured={isAppriseConfigured}
            />

            <div className="pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isUsingAllGlobalSettings || !isOnline}
                  >
                    <RotateCcw className="me-2 size-4" />
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
      {repositoryTagDragPreview &&
        createPortal(
          <div
            ref={repositoryTagDragPreviewRef}
            aria-hidden="true"
            data-tag-drag-preview="true"
            className="pointer-events-none fixed z-100"
            style={{
              left: repositoryTagDragPreview.left,
              top: repositoryTagDragPreview.top,
              width: repositoryTagDragSize.width,
              height: repositoryTagDragSize.height,
            }}
          >
            <Badge
              variant="secondary"
              className="h-full w-full gap-0 py-1 ps-1 pe-1 opacity-95 shadow-xl ring-2 ring-primary/50"
            >
              {isRtl ? (
                <ChevronRight
                  className={cn(
                    "size-3",
                    repositoryTagDragPreview.fromIndex === 0 && "opacity-30",
                  )}
                />
              ) : (
                <ChevronLeft
                  className={cn(
                    "size-3",
                    repositoryTagDragPreview.fromIndex === 0 && "opacity-30",
                  )}
                />
              )}
              <bdi dir="ltr" className="max-w-64 truncate px-1">
                {repositoryTagDragPreview.tag}
              </bdi>
              {isRtl ? (
                <ChevronLeft
                  className={cn(
                    "size-3",
                    repositoryTagDragPreview.fromIndex ===
                      repositoryTags.length - 1 && "opacity-30",
                  )}
                />
              ) : (
                <ChevronRight
                  className={cn(
                    "size-3",
                    repositoryTagDragPreview.fromIndex ===
                      repositoryTags.length - 1 && "opacity-30",
                  )}
                />
              )}
              <X className="size-3" />
            </Badge>
          </div>,
          document.body,
        )}
    </>
  );
}

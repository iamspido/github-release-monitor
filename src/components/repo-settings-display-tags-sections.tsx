"use client";

import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import type { RepoSettingsDisplayController } from "@/components/repo-settings-section-controller-types";
import { RepositoryTagPicker } from "@/components/repository-tag-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { getRepositoryNameFromId } from "@/lib/repo-id-display";
import { MAX_REPOSITORY_DISPLAY_NAME_LENGTH } from "@/lib/repositories/display-name";
import {
  MAX_REPOSITORY_TAG_LENGTH,
  MAX_REPOSITORY_TAGS,
} from "@/lib/repositories/tags";
import { cn } from "@/lib/utils";
import type { AppSettings, ReleaseSelectionStrategy } from "@/types";

export function RepoSettingsDisplayTagsSections({
  controller,
  globalSettings,
  repoId,
}: {
  controller: RepoSettingsDisplayController;
  globalSettings: AppSettings;
  repoId: string;
}) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const {
    addRepositoryTags,
    commitRepositoryTagInput,
    displayName,
    displayNameId,
    draggedRepositoryTagIndex,
    effectiveReleaseSelectionStrategy,
    handleRepositoryTagLostPointerCapture,
    handleRepositoryTagPointerCancel,
    handleRepositoryTagPointerDown,
    handleRepositoryTagPointerEnd,
    handleRepositoryTagPointerMove,
    hasDisplayNameError,
    isOnline,
    isPinned,
    isPinnedId,
    isRtl,
    releaseSelectionStrategy,
    releaseSelectionStrategyId,
    removeRepositoryTag,
    reorderRepositoryTag,
    repositoryTagDragSize,
    repositoryTagDropIndex,
    repositoryTagErrorMessage,
    repositoryTagInput,
    repositoryTagListRef,
    repositoryTagOrderAnnouncement,
    repositoryTagSuggestions,
    repositoryTags,
    repositoryTagsId,
    requestImmediateSave,
    setDisplayName,
    setIsPinned,
    setReleaseSelectionStrategy,
    setRepositoryTagError,
    setRepositoryTagInput,
    setVersionTagPattern,
    useDefaultVersionTagPattern,
    useGlobalReleaseSelection,
    versionTagPattern,
    versionTagPatternError,
    versionTagPatternId,
  } = controller;

  return (
    <>
      <div className="space-y-4 p-4 border rounded-md">
        <div>
          <h4 className="font-semibold text-base">
            {t("display_section_title")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("display_section_description")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={displayNameId}>{t("display_name_label")}</Label>
          <Input
            id={displayNameId}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={MAX_REPOSITORY_DISPLAY_NAME_LENGTH}
            placeholder={getRepositoryNameFromId(repoId)}
            disabled={!isOnline}
            aria-invalid={hasDisplayNameError}
            className={cn(
              hasDisplayNameError &&
                "border-destructive focus-visible:ring-destructive",
            )}
          />
          {hasDisplayNameError ? (
            <p className="text-sm text-destructive">
              {t("display_name_error_invalid")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("display_name_hint")}
            </p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id={isPinnedId}
            checked={isPinned}
            onCheckedChange={(checked) => setIsPinned(checked === true)}
            disabled={!isOnline}
          />
          <div className="grid gap-1.5 leading-none">
            <Label htmlFor={isPinnedId}>{t("pin_to_top_label")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("pin_to_top_description")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 border rounded-md">
        <Label
          htmlFor={releaseSelectionStrategyId}
          className="font-semibold text-base"
        >
          {tGlobal("release_selection_strategy_label")}
        </Label>
        <div className="flex items-center gap-2">
          <Select
            value={releaseSelectionStrategy ?? "global"}
            onValueChange={(value: ReleaseSelectionStrategy | "global") =>
              setReleaseSelectionStrategy(
                value === "global" ? undefined : value,
              )
            }
            disabled={!isOnline}
          >
            <SelectTrigger id={releaseSelectionStrategyId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">
                {t("release_selection_option_global", {
                  strategy: tGlobal(
                    `release_selection_${globalSettings.releaseSelectionStrategy ?? "newest"}`,
                  ),
                })}
              </SelectItem>
              <SelectItem value="newest">
                {tGlobal("release_selection_newest")}
              </SelectItem>
              <SelectItem value="provider_latest">
                {tGlobal("release_selection_provider_latest")}
              </SelectItem>
              <SelectItem value="highest_version">
                {tGlobal("release_selection_highest_version")}
              </SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    requestImmediateSave();
                    setReleaseSelectionStrategy(undefined);
                  }}
                  className="size-8 shrink-0"
                  disabled={!isOnline || useGlobalReleaseSelection}
                >
                  <RotateCcw className="size-4" />
                  <span className="sr-only">
                    {t("release_selection_reset_button")}
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
          {tGlobal(
            `release_selection_${releaseSelectionStrategy ?? globalSettings.releaseSelectionStrategy ?? "newest"}_hint`,
          )}
        </p>
        <div className="space-y-2">
          <Label htmlFor={versionTagPatternId}>
            {t("version_tag_pattern_label")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={versionTagPatternId}
              dir="ltr"
              value={versionTagPattern}
              onChange={(event) => setVersionTagPattern(event.target.value)}
              placeholder={t("version_tag_pattern_placeholder")}
              className="font-mono"
              disabled={
                !isOnline ||
                effectiveReleaseSelectionStrategy !== "highest_version"
              }
              aria-invalid={Boolean(versionTagPatternError)}
              aria-describedby={`${versionTagPatternId}-description`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                requestImmediateSave();
                setVersionTagPattern("");
              }}
              className="size-8 shrink-0"
              disabled={!isOnline || useDefaultVersionTagPattern}
            >
              <RotateCcw className="size-4" />
              <span className="sr-only">
                {t("version_tag_pattern_reset_button")}
              </span>
            </Button>
          </div>
          <p
            id={`${versionTagPatternId}-description`}
            className="text-xs text-muted-foreground"
          >
            {t("version_tag_pattern_hint")}
          </p>
          {versionTagPatternError ? (
            <p className="text-sm text-destructive">
              {t(
                versionTagPatternError === "missing_version_group"
                  ? "version_tag_pattern_error_missing_version_group"
                  : "version_tag_pattern_error_invalid",
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-4 border rounded-md">
        <div>
          <h4 className="font-semibold text-base">{t("tags_section_title")}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("tags_section_description", {
              maxTags: MAX_REPOSITORY_TAGS,
              maxLength: MAX_REPOSITORY_TAG_LENGTH,
            })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={repositoryTagsId} className="block">
            {t("tags_label")}
          </Label>
          {repositoryTags.length > 0 && (
            <>
              <ul
                ref={repositoryTagListRef}
                className="relative m-0 flex list-none flex-wrap items-center gap-2 p-0"
                aria-label={t("tags_reorder_list_aria")}
              >
                {repositoryTags.map((tag, index) => (
                  <React.Fragment key={tag}>
                    {repositoryTagDropIndex === index && (
                      <li
                        aria-hidden="true"
                        data-tag-drop-placeholder="true"
                        className="rounded-full border-2 border-dashed border-primary/70 bg-primary/5"
                        style={repositoryTagDragSize}
                      />
                    )}
                    <li
                      data-repository-tag-index={index}
                      data-repository-tag-dragging={
                        draggedRepositoryTagIndex === index ? "true" : undefined
                      }
                      aria-hidden={
                        draggedRepositoryTagIndex === index ? true : undefined
                      }
                      className={cn(
                        draggedRepositoryTagIndex === index &&
                          "absolute opacity-0",
                      )}
                    >
                      <Badge
                        variant="secondary"
                        onPointerDown={(event) =>
                          handleRepositoryTagPointerDown(event, index, tag)
                        }
                        onPointerMove={handleRepositoryTagPointerMove}
                        onPointerUp={handleRepositoryTagPointerEnd}
                        onPointerCancel={handleRepositoryTagPointerCancel}
                        onLostPointerCapture={
                          handleRepositoryTagLostPointerCapture
                        }
                        title={t("tags_drag_aria", { tag })}
                        className={cn(
                          "gap-0 py-1 ps-1 pe-1 select-none",
                          isOnline &&
                            repositoryTags.length > 1 &&
                            "cursor-grab touch-none active:cursor-grabbing",
                          draggedRepositoryTagIndex === index &&
                            "ring-2 ring-primary/40",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => reorderRepositoryTag(index, index - 1)}
                          disabled={!isOnline || index === 0}
                          className="rounded-sm p-0.5 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                          aria-label={t(
                            isRtl
                              ? "tags_move_right_aria"
                              : "tags_move_left_aria",
                            { tag },
                          )}
                        >
                          {isRtl ? (
                            <ChevronRight className="size-3" />
                          ) : (
                            <ChevronLeft className="size-3" />
                          )}
                        </button>
                        <bdi dir="ltr" className="max-w-64 truncate px-1">
                          {tag}
                        </bdi>
                        <button
                          type="button"
                          onClick={() => reorderRepositoryTag(index, index + 1)}
                          disabled={
                            !isOnline || index === repositoryTags.length - 1
                          }
                          className="rounded-sm p-0.5 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                          aria-label={t(
                            isRtl
                              ? "tags_move_left_aria"
                              : "tags_move_right_aria",
                            { tag },
                          )}
                        >
                          {isRtl ? (
                            <ChevronLeft className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRepositoryTag(tag)}
                          disabled={!isOnline}
                          className="rounded-sm p-0.5 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          aria-label={t("tags_remove_aria", { tag })}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    </li>
                  </React.Fragment>
                ))}
                {repositoryTagDropIndex === repositoryTags.length && (
                  <li
                    aria-hidden="true"
                    data-tag-drop-placeholder="true"
                    className="rounded-full border-2 border-dashed border-primary/70 bg-primary/5"
                    style={repositoryTagDragSize}
                  />
                )}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t("tags_reorder_hint")}
              </p>
              <p className="sr-only" aria-live="polite">
                {repositoryTagOrderAnnouncement}
              </p>
            </>
          )}
          <RepositoryTagPicker
            id={repositoryTagsId}
            options={repositoryTagSuggestions}
            selectedTags={repositoryTags}
            value={repositoryTagInput}
            onValueChange={(value) => {
              const parts = value.split(",");
              if (parts.length === 1) {
                setRepositoryTagInput(value);
                setRepositoryTagError(null);
                return;
              }

              const pendingInput = parts.pop() ?? "";
              if (addRepositoryTags(parts)) {
                setRepositoryTagInput(pendingInput);
              }
            }}
            onTagSelect={(tag) => addRepositoryTags([tag])}
            onCreateTag={(tag) => {
              if (!addRepositoryTags([tag])) return false;
              setRepositoryTagInput("");
              return true;
            }}
            onInputBlur={commitRepositoryTagInput}
            placeholder={t("tags_placeholder")}
            listboxLabel={t("tags_existing_label")}
            createOptionLabel={(tag) => t("tags_create_option", { tag })}
            disabled={!isOnline || repositoryTags.length >= MAX_REPOSITORY_TAGS}
            invalid={Boolean(repositoryTagErrorMessage)}
          />
          {repositoryTagErrorMessage ? (
            <p className="text-sm text-destructive">
              {repositoryTagErrorMessage}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("tags_input_hint")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

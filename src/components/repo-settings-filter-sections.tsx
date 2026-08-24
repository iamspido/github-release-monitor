"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RepoSettingsFilterController } from "@/components/repo-settings-section-controller-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";
import { allPreReleaseTypes } from "@/types";

export function RepoSettingsFilterSections({
  controller,
  globalSettings,
}: {
  controller: RepoSettingsFilterController;
  globalSettings: AppSettings;
}) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const {
    customPreReleaseMarkers,
    customPreReleaseMarkersId,
    draftId,
    effectivePreReleaseSubChannels,
    excludeRegex,
    excludeRegexError,
    excludeRegexId,
    handleChannelChange,
    handleDeselectAllPreRelease,
    handlePreReleaseSubChannelChange,
    handleResetFilters,
    handleSelectAllPreRelease,
    includeRegex,
    includeRegexError,
    includeRegexId,
    invalidCustomPreReleaseMarkers,
    isDraftChecked,
    isOnline,
    isPreReleaseChecked,
    isStableChecked,
    prereleaseId,
    prereleaseSubChannelBaseId,
    setCustomPreReleaseMarkers,
    setExcludeRegex,
    setIncludeRegex,
    setUseGlobalCustomPreReleaseMarkers,
    stableId,
    useGlobalChannels,
    useGlobalCustomPreReleaseMarkers,
    useGlobalCustomPreReleaseMarkersId,
  } = controller;

  return (
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
                <span className="sr-only">{t("reset_to_global_button")}</span>
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

      <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-2">
          <Checkbox
            id={prereleaseId}
            checked={isPreReleaseChecked}
            onCheckedChange={() => handleChannelChange("prerelease")}
            disabled={!isOnline}
          />
          <Label htmlFor={prereleaseId} className="font-normal cursor-pointer">
            {tGlobal("release_channel_prerelease")}
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
                disabled={!isPreReleaseChecked || !isOnline}
              >
                {tGlobal("prerelease_select_all")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeselectAllPreRelease}
                disabled={!isPreReleaseChecked || !isOnline}
              >
                {tGlobal("prerelease_deselect_all")}
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              {allPreReleaseTypes.map((subType) => {
                const subChannelId = `${prereleaseSubChannelBaseId}-${subType}`;
                return (
                  <div key={subType} className="flex items-center gap-2">
                    <Checkbox
                      id={subChannelId}
                      checked={effectivePreReleaseSubChannels.includes(subType)}
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

      <div className="space-y-2 ms-6 ps-3 border-s-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={useGlobalCustomPreReleaseMarkersId}
            checked={useGlobalCustomPreReleaseMarkers}
            onCheckedChange={(checked) => {
              const useGlobal = checked === true;
              setUseGlobalCustomPreReleaseMarkers(useGlobal);
              if (!useGlobal && !customPreReleaseMarkers) {
                setCustomPreReleaseMarkers(
                  (globalSettings.customPreReleaseMarkers ?? []).join(", "),
                );
              }
            }}
            disabled={!isOnline}
          />
          <Label
            htmlFor={useGlobalCustomPreReleaseMarkersId}
            className="font-normal cursor-pointer text-sm"
          >
            {tGlobal("custom_prerelease_markers_use_global")}
          </Label>
        </div>
        <Label htmlFor={customPreReleaseMarkersId}>
          {tGlobal("custom_prerelease_markers_label")}
        </Label>
        <Input
          id={customPreReleaseMarkersId}
          dir="auto"
          value={
            useGlobalCustomPreReleaseMarkers
              ? (globalSettings.customPreReleaseMarkers ?? []).join(", ")
              : customPreReleaseMarkers
          }
          onChange={(event) => setCustomPreReleaseMarkers(event.target.value)}
          placeholder={tGlobal("custom_prerelease_markers_placeholder")}
          disabled={useGlobalCustomPreReleaseMarkers || !isOnline}
          aria-invalid={invalidCustomPreReleaseMarkers.length > 0}
          className={cn(
            invalidCustomPreReleaseMarkers.length > 0 &&
              "border-destructive focus-visible:ring-destructive",
          )}
        />
        {invalidCustomPreReleaseMarkers.length > 0 ? (
          <p className="text-sm text-destructive">
            {tGlobal("custom_prerelease_markers_error_invalid")}{" "}
            {invalidCustomPreReleaseMarkers.join(", ")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {tGlobal("custom_prerelease_markers_description")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
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
        <Label htmlFor={includeRegexId}>{tGlobal("include_regex_label")}</Label>
        <Input
          id={includeRegexId}
          dir="ltr"
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
        <Label htmlFor={excludeRegexId}>{tGlobal("exclude_regex_label")}</Label>
        <Input
          id={excludeRegexId}
          dir="ltr"
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
  );
}

"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RepoSettingsDeliveryController } from "@/components/repo-settings-section-controller-types";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { AppriseFormat, AppSettings } from "@/types";

export function RepoSettingsDeliverySections({
  controller,
  globalSettings,
  isAppriseConfigured,
}: {
  controller: RepoSettingsDeliveryController;
  globalSettings: AppSettings;
  isAppriseConfigured: boolean;
}) {
  const t = useTranslations("RepoSettingsDialog");
  const tGlobal = useTranslations("SettingsForm");
  const {
    appriseFormat,
    appriseFormatId,
    appriseTags,
    appriseTagsId,
    isOnline,
    releasesPerPage,
    releasesPerPageError,
    releasesPerPageId,
    requestImmediateSave,
    setAppriseFormat,
    setAppriseTags,
    setReleasesPerPage,
    useGlobalAppriseFormat,
    useGlobalAppriseTags,
    useGlobalReleasesPerPage,
  } = controller;

  return (
    <>
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
            step={1}
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
                  onClick={() => {
                    requestImmediateSave();
                    setReleasesPerPage("");
                  }}
                  className="size-8 shrink-0"
                  disabled={!isOnline}
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
        {releasesPerPageError === "invalid" ? (
          <p className="mt-2 text-sm text-destructive">
            {tGlobal("integer_error_invalid")}
          </p>
        ) : releasesPerPageError === "too_low" ? (
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
                    onClick={() => {
                      requestImmediateSave();
                      setAppriseFormat("");
                    }}
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
              dir="ltr"
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
                    onClick={() => {
                      requestImmediateSave();
                      setAppriseTags("");
                    }}
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
    </>
  );
}

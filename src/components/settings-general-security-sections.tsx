"use client";

import { useTranslations } from "next-intl";
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
import { Textarea } from "@/components/ui/textarea";
import type { SettingsFormController } from "@/components/use-settings-form-controller";
import { localeDisplayMetadata } from "@/i18n/locale-display";
import {
  defaultSecurityHighlightCustomColor,
  isValidSecurityHighlightCustomColor,
  normalizeSecurityHighlightColorPreset,
} from "@/lib/security-release";
import { cn } from "@/lib/utils";
import type {
  Locale,
  ReleaseProviderSortKey,
  ReleaseSortOrder,
  SecurityHighlightColorPreset,
  TimeFormat,
} from "@/types";
import { defaultProviderSortOrder } from "@/types";

const providerSortOrderOptions: ReleaseProviderSortKey[][] = [
  ["github", "gitlab", "codeberg"],
  ["github", "codeberg", "gitlab"],
  ["gitlab", "github", "codeberg"],
  ["gitlab", "codeberg", "github"],
  ["codeberg", "github", "gitlab"],
  ["codeberg", "gitlab", "github"],
];

const securityHighlightColorOptions = [
  {
    value: "yellow",
    labelKey: "security_highlight_color_yellow",
    swatchClassName: "bg-yellow-500",
  },
  {
    value: "red",
    labelKey: "security_highlight_color_red",
    swatchClassName: "bg-red-500",
  },
  {
    value: "orange",
    labelKey: "security_highlight_color_orange",
    swatchClassName: "bg-orange-500",
  },
  {
    value: "blue",
    labelKey: "security_highlight_color_blue",
    swatchClassName: "bg-blue-500",
  },
  {
    value: "purple",
    labelKey: "security_highlight_color_purple",
    swatchClassName: "bg-purple-500",
  },
  {
    value: "custom",
    labelKey: "security_highlight_color_custom",
    swatchClassName: "",
  },
] as const satisfies readonly {
  value: SecurityHighlightColorPreset;
  labelKey: string;
  swatchClassName: string;
}[];

function serializeProviderSortOrder(order: ReleaseProviderSortKey[]) {
  return order.join(",");
}

function deserializeProviderSortOrder(value: string): ReleaseProviderSortKey[] {
  const parts = value.split(",") as ReleaseProviderSortKey[];
  const selected = providerSortOrderOptions.find(
    (option) =>
      serializeProviderSortOrder(option) === serializeProviderSortOrder(parts),
  );
  return selected ?? defaultProviderSortOrder;
}

export function GeneralSecuritySettingsSections({
  controller,
  onTimeFormatChange,
}: {
  controller: SettingsFormController;
  onTimeFormatChange?: (timeFormat: TimeFormat) => void;
}) {
  const t = useTranslations("SettingsForm");
  const {
    confirmSecurityAcknowledge,
    customSecurityPatterns,
    customSecurityPatternsError,
    ids,
    includeDefaultSecurityPatterns,
    isOnline,
    locale,
    prioritizeNewSecurityReleases,
    providerSortOrder,
    releaseSortOrder,
    repositoryFormExpanded,
    requestImmediateSave,
    securityHighlightColorPreset,
    securityHighlightCustomColor,
    securityHighlightCustomColorError,
    setConfirmSecurityAcknowledge,
    setCustomSecurityPatterns,
    setIncludeDefaultSecurityPatterns,
    setLocale,
    setPrioritizeNewSecurityReleases,
    setProviderSortOrder,
    setReleaseSortOrder,
    setRepositoryFormExpanded,
    setSecurityHighlightColorPreset,
    setSecurityHighlightCustomColor,
    setShowAcknowledge,
    setShowMarkAsNew,
    setShowProviderDomainInRepoId,
    setShowProviderPrefixInRepoId,
    setTimeFormat,
    showAcknowledge,
    showMarkAsNew,
    showProviderDomainInRepoId,
    showProviderPrefixInRepoId,
    timeFormat,
  } = controller;

  return (
    <>
      <Card>
        <CardHeader>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t("time_format_label")}</Label>
            <RadioGroup
              value={timeFormat}
              onValueChange={(value: TimeFormat) => {
                setTimeFormat(value);
                onTimeFormatChange?.(value);
              }}
              className="flex items-center gap-4"
              disabled={!isOnline}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="12h"
                  id={ids.timeFormat12h}
                  data-testid="time-format-12h"
                />
                <Label htmlFor={ids.timeFormat12h}>
                  {t("time_format_12h")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="24h"
                  id={ids.timeFormat24h}
                  data-testid="time-format-24h"
                />
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
              disabled={!isOnline}
            >
              <SelectTrigger
                id={ids.languageSelect}
                data-testid="language-select"
                className="w-full sm:w-[180px]"
              >
                <SelectValue placeholder={t("language_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {localeDisplayMetadata.map(({ code, nativeName }) => (
                  <SelectItem
                    key={code}
                    value={code}
                    dir="auto"
                    data-testid={`language-option-${code}`}
                  >
                    {nativeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.releaseSortOrder}>
              {t("release_sort_order_label")}
            </Label>
            <Select
              value={releaseSortOrder}
              onValueChange={(value: ReleaseSortOrder) =>
                setReleaseSortOrder(value)
              }
              disabled={!isOnline}
            >
              <SelectTrigger
                id={ids.releaseSortOrder}
                className="w-full sm:w-[260px]"
              >
                <SelectValue placeholder={t("release_sort_latest_first")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest_first">
                  {t("release_sort_latest_first")}
                </SelectItem>
                <SelectItem value="new_first">
                  {t("release_sort_new_first")}
                </SelectItem>
                <SelectItem value="oldest_first">
                  {t("release_sort_oldest_first")}
                </SelectItem>
                <SelectItem value="repo_az">
                  {t("release_sort_repo_az")}
                </SelectItem>
                <SelectItem value="repo_za">
                  {t("release_sort_repo_za")}
                </SelectItem>
                <SelectItem value="provider_grouped">
                  {t("release_sort_provider_grouped")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {releaseSortOrder === "provider_grouped" && (
            <div className="space-y-2">
              <Label htmlFor={ids.providerSortOrder}>
                {t("provider_sort_order_label")}
              </Label>
              <Select
                value={serializeProviderSortOrder(providerSortOrder)}
                onValueChange={(value) =>
                  setProviderSortOrder(deserializeProviderSortOrder(value))
                }
                disabled={!isOnline}
              >
                <SelectTrigger
                  id={ids.providerSortOrder}
                  className="w-full sm:w-[260px]"
                >
                  <SelectValue
                    placeholder={t("provider_sort_order_placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {providerSortOrderOptions.map((option) => (
                    <SelectItem
                      key={serializeProviderSortOrder(option)}
                      value={serializeProviderSortOrder(option)}
                    >
                      {option
                        .map((provider) => t(`provider_${provider}`))
                        .join(" / ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.showAcknowledge}
                checked={showAcknowledge}
                onCheckedChange={(checked) =>
                  setShowAcknowledge(Boolean(checked))
                }
                disabled={!isOnline}
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
                "ms-6 ps-3 border-s-2 transition-all duration-300 ease-in-out overflow-hidden",
                showAcknowledge
                  ? "mt-4 max-h-96 opacity-100"
                  : "max-h-0 opacity-0",
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.showMarkAsNew}
                  checked={showMarkAsNew}
                  onCheckedChange={(checked) =>
                    setShowMarkAsNew(Boolean(checked))
                  }
                  disabled={!showAcknowledge || !isOnline}
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
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.showProviderPrefixInRepoId}
                checked={showProviderPrefixInRepoId}
                onCheckedChange={(checked) =>
                  setShowProviderPrefixInRepoId(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.showProviderPrefixInRepoId}
                  className="font-medium cursor-pointer"
                >
                  {t("show_provider_prefix_in_repo_id_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("show_provider_prefix_in_repo_id_description")}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.showProviderDomainInRepoId}
                checked={showProviderDomainInRepoId}
                onCheckedChange={(checked) =>
                  setShowProviderDomainInRepoId(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.showProviderDomainInRepoId}
                  className="font-medium cursor-pointer"
                >
                  {t("show_provider_domain_in_repo_id_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("show_provider_domain_in_repo_id_description")}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.repositoryFormExpanded}
                checked={repositoryFormExpanded}
                onCheckedChange={(checked) =>
                  setRepositoryFormExpanded(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.repositoryFormExpanded}
                  className="font-medium cursor-pointer"
                >
                  {t("repository_form_expanded_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("repository_form_expanded_description")}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("security_releases_settings_title")}</CardTitle>
          <CardDescription>
            {t("security_releases_settings_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start gap-3">
            <Checkbox
              id={ids.prioritizeNewSecurityReleases}
              checked={prioritizeNewSecurityReleases}
              onCheckedChange={(checked) =>
                setPrioritizeNewSecurityReleases(Boolean(checked))
              }
              disabled={!isOnline}
              className="mt-1"
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor={ids.prioritizeNewSecurityReleases}
                className="font-medium cursor-pointer"
              >
                {t("prioritize_new_security_releases_title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("prioritize_new_security_releases_description")}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Label>{t("security_highlight_color_label")}</Label>
            <RadioGroup
              value={securityHighlightColorPreset}
              onValueChange={(value) =>
                setSecurityHighlightColorPreset(
                  normalizeSecurityHighlightColorPreset(value),
                )
              }
              className="grid gap-2 sm:grid-cols-2"
              disabled={!isOnline}
            >
              {securityHighlightColorOptions.map((option) => {
                const optionId = `${ids.securityHighlightColor}-${option.value}`;
                const customSwatchColor = isValidSecurityHighlightCustomColor(
                  securityHighlightCustomColor,
                )
                  ? securityHighlightCustomColor
                  : defaultSecurityHighlightCustomColor;
                return (
                  <div
                    key={option.value}
                    className="flex items-center gap-2 rounded-md border p-3"
                  >
                    <RadioGroupItem value={option.value} id={optionId} />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 rounded-full border",
                        option.swatchClassName,
                      )}
                      style={
                        option.value === "custom"
                          ? { backgroundColor: customSwatchColor }
                          : undefined
                      }
                    />
                    <Label
                      htmlFor={optionId}
                      className="cursor-pointer font-normal"
                    >
                      {t(option.labelKey)}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
            {securityHighlightColorPreset === "custom" && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[auto_1fr]">
                <div className="space-y-2">
                  <Label htmlFor={ids.securityHighlightCustomColorPicker}>
                    {t("security_highlight_color_picker_label")}
                  </Label>
                  <Input
                    id={ids.securityHighlightCustomColorPicker}
                    type="color"
                    value={
                      isValidSecurityHighlightCustomColor(
                        securityHighlightCustomColor,
                      )
                        ? securityHighlightCustomColor
                        : defaultSecurityHighlightCustomColor
                    }
                    onChange={(event) => {
                      requestImmediateSave();
                      setSecurityHighlightCustomColor(
                        event.target.value.toLowerCase(),
                      );
                    }}
                    disabled={!isOnline}
                    className="h-10 w-16 p-1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={ids.securityHighlightCustomColor}>
                    {t("security_highlight_hex_label")}
                  </Label>
                  <Input
                    id={ids.securityHighlightCustomColor}
                    dir="ltr"
                    value={securityHighlightCustomColor}
                    onChange={(event) =>
                      setSecurityHighlightCustomColor(event.target.value)
                    }
                    placeholder={defaultSecurityHighlightCustomColor}
                    disabled={!isOnline}
                    className={cn(
                      !!securityHighlightCustomColorError &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {securityHighlightCustomColorError ? (
                    <p className="text-sm text-destructive">
                      {t("security_highlight_hex_error_invalid")}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("security_highlight_hex_hint")}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id={ids.confirmSecurityAcknowledge}
              checked={confirmSecurityAcknowledge}
              onCheckedChange={(checked) =>
                setConfirmSecurityAcknowledge(Boolean(checked))
              }
              disabled={!isOnline}
              className="mt-1"
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor={ids.confirmSecurityAcknowledge}
                className="font-medium cursor-pointer"
              >
                {t("confirm_security_acknowledge_title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("confirm_security_acknowledge_description")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.includeDefaultSecurityPatterns}
                checked={includeDefaultSecurityPatterns}
                onCheckedChange={(checked) =>
                  setIncludeDefaultSecurityPatterns(Boolean(checked))
                }
                disabled={!isOnline}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor={ids.includeDefaultSecurityPatterns}
                  className="font-medium cursor-pointer"
                >
                  {t("include_default_security_patterns_title")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("include_default_security_patterns_description")}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.customSecurityPatterns}>
                {t("custom_security_patterns_label")}
              </Label>
              <Textarea
                id={ids.customSecurityPatterns}
                dir="ltr"
                value={customSecurityPatterns}
                onChange={(event) =>
                  setCustomSecurityPatterns(event.target.value)
                }
                placeholder={t("custom_security_patterns_placeholder")}
                disabled={!isOnline}
                className={cn(
                  "min-h-32 font-mono text-sm",
                  !!customSecurityPatternsError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {customSecurityPatternsError ? (
                <p className="text-sm text-destructive">
                  {t("security_patterns_error_invalid")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("custom_security_patterns_hint")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

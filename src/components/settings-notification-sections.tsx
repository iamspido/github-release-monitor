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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsFormController } from "@/components/use-settings-form-controller";
import type { AppriseFormat, NotificationMode } from "@/types";

export function NotificationSettingsSections({
  controller,
  isAppriseConfigured,
}: {
  controller: SettingsFormController;
  isAppriseConfigured: boolean;
}) {
  const t = useTranslations("SettingsForm");
  const {
    appriseFormat,
    appriseIncludeReleaseNotes,
    appriseMaxCharacters,
    appriseNotificationMode,
    appriseTags,
    emailIncludeReleaseNotes,
    emailNotificationMode,
    ids,
    isOnline,
    notificationDeliveryConcurrency,
    notificationDeliveryConcurrencyError,
    notificationMaxMessagesError,
    notificationMaxMessagesPerRun,
    setAppriseFormat,
    setAppriseIncludeReleaseNotes,
    setAppriseMaxCharacters,
    setAppriseNotificationMode,
    setAppriseTags,
    setEmailIncludeReleaseNotes,
    setEmailNotificationMode,
    setNotificationDeliveryConcurrency,
    setNotificationMaxMessagesPerRun,
  } = controller;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("notification_delivery_settings_title")}</CardTitle>
          <CardDescription>
            {t("notification_delivery_settings_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label htmlFor={ids.emailNotificationMode}>
                {t("email_notification_mode_label")}
              </Label>
              <Select
                value={emailNotificationMode}
                onValueChange={(value: NotificationMode) =>
                  setEmailNotificationMode(value)
                }
                disabled={!isOnline}
              >
                <SelectTrigger
                  id={ids.emailNotificationMode}
                  className="mt-2 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_release">
                    {t("notification_mode_per_release")}
                  </SelectItem>
                  <SelectItem value="batch">
                    {t("notification_mode_batch")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={ids.appriseNotificationMode}>
                {t("apprise_notification_mode_label")}
              </Label>
              <Select
                value={appriseNotificationMode}
                onValueChange={(value: NotificationMode) =>
                  setAppriseNotificationMode(value)
                }
                disabled={!isOnline}
              >
                <SelectTrigger
                  id={ids.appriseNotificationMode}
                  className="mt-2 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_release">
                    {t("notification_mode_per_release")}
                  </SelectItem>
                  <SelectItem value="batch">
                    {t("notification_mode_batch")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label htmlFor={ids.notificationMaxMessagesPerRun}>
                {t("notification_max_messages_label")}
              </Label>
              <Input
                id={ids.notificationMaxMessagesPerRun}
                type="number"
                value={notificationMaxMessagesPerRun}
                onChange={(event) =>
                  setNotificationMaxMessagesPerRun(event.target.value)
                }
                min={0}
                max={10000}
                step={1}
                disabled={!isOnline}
                className="mt-2 w-full sm:w-48"
                aria-invalid={Boolean(notificationMaxMessagesError)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("notification_max_messages_hint")}
              </p>
              {notificationMaxMessagesError && (
                <p className="mt-2 text-xs text-destructive">
                  {t(
                    notificationMaxMessagesError === "invalid"
                      ? "integer_error_invalid"
                      : notificationMaxMessagesError === "too_low"
                        ? "notification_max_messages_error_min"
                        : "notification_max_messages_error_max",
                  )}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor={ids.notificationDeliveryConcurrency}>
                {t("notification_delivery_concurrency_label")}
              </Label>
              <Input
                id={ids.notificationDeliveryConcurrency}
                type="number"
                value={notificationDeliveryConcurrency}
                onChange={(event) =>
                  setNotificationDeliveryConcurrency(event.target.value)
                }
                min={1}
                max={50}
                step={1}
                disabled={!isOnline}
                className="mt-2 w-full sm:w-48"
                aria-invalid={Boolean(notificationDeliveryConcurrencyError)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("notification_delivery_concurrency_hint")}
              </p>
              {notificationDeliveryConcurrencyError && (
                <p className="mt-2 text-xs text-destructive">
                  {t(
                    notificationDeliveryConcurrencyError === "invalid"
                      ? "integer_error_invalid"
                      : notificationDeliveryConcurrencyError === "too_low"
                        ? "notification_delivery_concurrency_error_min"
                        : "notification_delivery_concurrency_error_max",
                  )}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("notification_content_settings_title")}</CardTitle>
          <CardDescription>
            {t("notification_content_settings_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Checkbox
              id={ids.emailIncludeReleaseNotes}
              checked={emailIncludeReleaseNotes}
              onCheckedChange={(checked) =>
                setEmailIncludeReleaseNotes(Boolean(checked))
              }
              disabled={!isOnline}
            />
            <Label
              htmlFor={ids.emailIncludeReleaseNotes}
              className="font-medium cursor-pointer"
            >
              {t("email_include_release_notes_label")}
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id={ids.appriseIncludeReleaseNotes}
              checked={appriseIncludeReleaseNotes}
              onCheckedChange={(checked) =>
                setAppriseIncludeReleaseNotes(Boolean(checked))
              }
              disabled={!isOnline}
            />
            <Label
              htmlFor={ids.appriseIncludeReleaseNotes}
              className="font-medium cursor-pointer"
            >
              {t("apprise_include_release_notes_label")}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("apprise_settings_title")}</CardTitle>
          <CardDescription>{t("apprise_settings_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor={ids.appriseMaxChars}>
              {t("apprise_max_chars_label")}
            </Label>
            <Input
              id={ids.appriseMaxChars}
              type="number"
              value={appriseMaxCharacters}
              onChange={(e) => setAppriseMaxCharacters(e.target.value)}
              min={0}
              disabled={!isAppriseConfigured || !isOnline}
              className="mt-2 w-full sm:w-48"
            />
            {isAppriseConfigured ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_max_chars_hint")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_max_chars_disabled_hint")}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor={ids.appriseFormat}>
              {t("apprise_format_label")}
            </Label>
            <Select
              value={appriseFormat}
              onValueChange={(value: AppriseFormat) => setAppriseFormat(value)}
              disabled={!isAppriseConfigured || !isOnline}
            >
              <SelectTrigger
                id={ids.appriseFormat}
                className="w-full sm:w-[180px] mt-2"
              >
                <SelectValue placeholder={t("apprise_format_text")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t("apprise_format_text")}</SelectItem>
                <SelectItem value="markdown">
                  {t("apprise_format_markdown")}
                </SelectItem>
                <SelectItem value="html">{t("apprise_format_html")}</SelectItem>
              </SelectContent>
            </Select>
            {isAppriseConfigured ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_format_hint")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_format_disabled_hint")}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor={ids.appriseTags}>{t("apprise_tags_label")}</Label>
            <Input
              id={ids.appriseTags}
              dir="ltr"
              type="text"
              value={appriseTags}
              onChange={(e) => setAppriseTags(e.target.value)}
              disabled={!isAppriseConfigured || !isOnline}
              className="mt-2 w-full"
              placeholder={t("apprise_tags_placeholder")}
            />
            {isAppriseConfigured ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_tags_hint")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("apprise_tags_disabled_hint")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

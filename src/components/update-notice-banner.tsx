"use client";

import { Loader2, Megaphone, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { dismissUpdateNotificationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useActionTransition } from "@/hooks/use-action-transition";
import { useUpdateNoticeStream } from "@/hooks/use-update-notice-stream";
import { isolateLtrText } from "@/lib/bidi";
import type { UpdateNotificationState } from "@/types";

type UpdateNoticeBannerProps = {
  notice?: UpdateNotificationState;
  canDismiss?: boolean;
};

export function UpdateNoticeBanner({
  notice: initialNotice,
  canDismiss = true,
}: UpdateNoticeBannerProps) {
  const t = useTranslations("UpdateNotice");
  const releaseT = useTranslations("ReleaseCard");
  const { isPending, runAction } = useActionTransition();
  const currentNotice = useUpdateNoticeStream(initialNotice).notice;

  const notificationKey = currentNotice?.shouldNotify
    ? JSON.stringify([
        currentNotice.latestVersion,
        currentNotice.latestSecurityVersion,
      ])
    : null;
  const [dismissedNotificationKey, setDismissedNotificationKey] =
    React.useState<string | null>(null);

  React.useEffect(() => {
    setDismissedNotificationKey((current) =>
      current === notificationKey ? current : null,
    );
  }, [notificationKey]);

  const isVisible =
    notificationKey !== null && dismissedNotificationKey !== notificationKey;

  if (!currentNotice || !isVisible) {
    return null;
  }

  const trimmedVersion = currentNotice.latestVersion?.trim();
  const trimmedSecurityVersion = currentNotice.latestSecurityVersion?.trim();
  const releaseUrl = trimmedVersion
    ? `https://github.com/iamspido/github-release-monitor/releases/tag/${encodeURIComponent(trimmedVersion)}`
    : "https://github.com/iamspido/github-release-monitor/releases";
  const isSecurityUpdate = currentNotice.isSecurityUpdate;
  const releaseTitle = currentNotice.latestReleaseTitle?.trim();

  const handleDismiss = () => {
    const versionToDismiss = currentNotice.latestVersion;
    const securityVersionToDismiss = currentNotice.latestSecurityVersion;
    if (!versionToDismiss) return;

    runAction(
      async () => {
        const result = await dismissUpdateNotificationAction(
          versionToDismiss,
          securityVersionToDismiss,
        );
        if (result.success) {
          setDismissedNotificationKey(notificationKey);
        }
      },
      (error) => {
        // eslint-disable-next-line no-console
        console.error("Failed to dismiss update notice:", error);
      },
    );
  };

  return (
    <div
      className={
        isSecurityUpdate
          ? "w-full border-b border-red-400/70 bg-red-500/20"
          : "w-full border-b border-blue-500/50 bg-blue-500/10"
      }
      role="status"
    >
      <div
        className={`container mx-auto flex flex-col gap-4 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between md:px-6 ${
          isSecurityUpdate ? "text-red-50" : "text-blue-100"
        }`}
      >
        <div className="flex flex-1 items-start gap-3">
          {isSecurityUpdate ? (
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-300" />
          ) : (
            <Megaphone className="mt-1 size-4 shrink-0 text-blue-200" />
          )}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {isSecurityUpdate && (
                <span className="rounded-full border border-red-300/70 bg-red-500/30 px-2 py-0.5 text-xs font-bold tracking-wide text-red-50">
                  <span className="uppercase">
                    {releaseT("security_release_badge")}
                  </span>
                  {trimmedSecurityVersion &&
                    trimmedSecurityVersion !== trimmedVersion && (
                      <>
                        {" · "}
                        <span className="normal-case">
                          {isolateLtrText(trimmedSecurityVersion)}
                        </span>
                      </>
                    )}
                </span>
              )}
              <p className="font-semibold">
                {t("title", {
                  version: isolateLtrText(currentNotice.latestVersion ?? "—"),
                })}
              </p>
            </div>
            {isSecurityUpdate && releaseTitle && (
              <p className="font-medium text-red-100">{releaseTitle}</p>
            )}
            <p
              className={
                isSecurityUpdate ? "text-red-100/90" : "text-blue-200/80"
              }
            >
              {t("description", {
                currentVersion: isolateLtrText(currentNotice.currentVersion),
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
              {t("cta_label")}
            </a>
          </Button>
          {canDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t("dismiss_label")
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

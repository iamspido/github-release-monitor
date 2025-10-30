"use client";

import { Loader2, Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { dismissUpdateNotificationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type { UpdateNotificationState } from "@/types";

type UpdateNoticeBannerProps = {
  notice?: UpdateNotificationState;
};

export function UpdateNoticeBanner({ notice }: UpdateNoticeBannerProps) {
  const t = useTranslations("UpdateNotice");
  const [isPending, startTransition] = React.useTransition();
  const [isVisible, setIsVisible] = React.useState<boolean>(
    notice?.shouldNotify ?? false,
  );

  React.useEffect(() => {
    setIsVisible(notice?.shouldNotify ?? false);
  }, [notice?.shouldNotify]);

  if (!notice || !isVisible) {
    return null;
  }

  const trimmedVersion = notice.latestVersion?.trim();
  const releaseUrl = trimmedVersion
    ? `https://github.com/iamspido/github-release-monitor/releases/tag/${encodeURIComponent(trimmedVersion)}`
    : "https://github.com/iamspido/github-release-monitor/releases";

  const handleDismiss = () => {
    setIsVisible(false);
    startTransition(async () => {
      try {
        await dismissUpdateNotificationAction();
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        // eslint-disable-next-line no-console
        console.error("Failed to dismiss update notice:", error);
      }
    });
  };

  return (
    <div className="w-full border-b border-blue-500/50 bg-blue-500/10">
      <div className="container mx-auto flex flex-col gap-4 px-4 py-3 text-sm text-blue-100 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex flex-1 items-start gap-3">
          <Megaphone className="mt-1 size-4 shrink-0 text-blue-200" />
          <div className="space-y-1">
            <p className="font-semibold">
              {t("title", { version: notice.latestVersion ?? "—" })}
            </p>
            <p className="text-blue-200/80">
              {t("description", {
                currentVersion: notice.currentVersion,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="secondary">
              {t("cta_label")}
            </Button>
          </a>
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
        </div>
      </div>
    </div>
  );
}

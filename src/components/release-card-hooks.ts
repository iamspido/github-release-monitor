"use client";

import { useFormatter } from "next-intl";
import * as React from "react";

import { useSharedMinuteTicker } from "@/hooks/use-shared-minute-ticker";
import type { GithubRelease } from "@/types";

type ReleaseTimeInput =
  | Pick<
      GithubRelease,
      "created_at" | "fetched_at" | "published_at" | "published_at_unknown"
    >
  | null
  | undefined;

function parseValidTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function useReleaseRelativeTimes(release: ReleaseTimeInput) {
  const format = useFormatter();
  const [timeAgo, setTimeAgo] = React.useState("");
  const [checkedAgo, setCheckedAgo] = React.useState("");
  const isReleaseTimeUnknown = Boolean(release?.published_at_unknown);
  const currentTime = useSharedMinuteTicker();

  React.useEffect(() => {
    const referenceTime = new Date(currentTime || Date.now());

    if (release?.created_at && !isReleaseTimeUnknown) {
      const releaseTime =
        parseValidTimestamp(release.published_at) ??
        parseValidTimestamp(release.created_at);
      setTimeAgo(
        releaseTime ? format.relativeTime(releaseTime, referenceTime) : "",
      );
    } else {
      setTimeAgo("");
    }

    const fetchedAt = parseValidTimestamp(release?.fetched_at);
    if (fetchedAt) {
      setCheckedAgo(format.relativeTime(fetchedAt, referenceTime));
    } else {
      setCheckedAgo("");
    }
  }, [release, format, isReleaseTimeUnknown, currentTime]);

  return { checkedAgo, isReleaseTimeUnknown, timeAgo };
}

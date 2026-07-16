"use client";

import { formatDistanceStrict } from "date-fns";
import { de } from "date-fns/locale";
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

export function useReleaseRelativeTimes(
  release: ReleaseTimeInput,
  locale: string,
) {
  const [timeAgo, setTimeAgo] = React.useState("");
  const [checkedAgo, setCheckedAgo] = React.useState("");
  const isReleaseTimeUnknown = Boolean(release?.published_at_unknown);
  const currentTime = useSharedMinuteTicker();

  React.useEffect(() => {
    const referenceTime = new Date(currentTime || Date.now());

    if (release?.created_at && !isReleaseTimeUnknown) {
      const dateToUse = release.published_at || release.created_at;
      setTimeAgo(
        formatDistanceStrict(new Date(dateToUse), referenceTime, {
          addSuffix: true,
          locale: locale === "de" ? de : undefined,
        }),
      );
    } else {
      setTimeAgo("");
    }

    if (release?.fetched_at) {
      setCheckedAgo(
        formatDistanceStrict(new Date(release.fetched_at), referenceTime, {
          addSuffix: true,
          locale: locale === "de" ? de : undefined,
        }),
      );
    } else {
      setCheckedAgo("");
    }
  }, [release, locale, isReleaseTimeUnknown, currentTime]);

  return { checkedAgo, isReleaseTimeUnknown, timeAgo };
}

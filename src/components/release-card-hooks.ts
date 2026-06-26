"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { de } from "date-fns/locale";
import * as React from "react";

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

  React.useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const updateTimes = () => {
      if (release?.created_at && !isReleaseTimeUnknown) {
        const dateToUse = release.published_at || release.created_at;
        setTimeAgo(
          formatDistanceToNowStrict(new Date(dateToUse), {
            addSuffix: true,
            locale: locale === "de" ? de : undefined,
          }),
        );
      } else {
        setTimeAgo("");
      }

      if (release?.fetched_at) {
        setCheckedAgo(
          formatDistanceToNowStrict(new Date(release.fetched_at), {
            addSuffix: true,
            locale: locale === "de" ? de : undefined,
          }),
        );
      } else {
        setCheckedAgo("");
      }
    };

    updateTimes();
    intervalId = setInterval(updateTimes, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [release, locale, isReleaseTimeUnknown]);

  return { checkedAgo, isReleaseTimeUnknown, timeAgo };
}

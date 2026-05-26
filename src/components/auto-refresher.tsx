"use client";

import { useEffect, useTransition } from "react";
import { refreshDueRepositoriesAction } from "@/app/actions";
import { useRouter } from "@/i18n/navigation";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

// Periodically asks the server to check repositories that are due by their
// per-repository background schedule, then refreshes Server Components.
export function AutoRefresher({
  intervalMinutes: _intervalMinutes,
}: {
  intervalMinutes: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const intervalMs = 60 * 1000;

    const intervalId = setInterval(() => {
      // Don't stack refreshes if one is already in progress.
      if (isPending) return;

      startTransition(async () => {
        // Skip when offline to avoid unhandled rejections.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        try {
          // By explicitly invalidating the cache on the server before refreshing,
          // we ensure that router.refresh() fetches the newest data
          // instead of potentially serving a stale version while revalidating.
          await refreshDueRepositoriesAction();
          router.refresh();
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) {
            return;
          }
          // Silently ignore transient network errors during background refreshes.
          // eslint-disable-next-line no-console
          console.debug("Auto refresh skipped due to error:", error);
        }
      });
    }, intervalMs);

    // Clean up the interval when the component unmounts or the interval changes.
    return () => clearInterval(intervalId);
  }, [router, isPending]);

  return null; // This component doesn't render any UI.
}

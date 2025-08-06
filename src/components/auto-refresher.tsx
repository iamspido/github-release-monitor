'use client';

import { useRouter } from '@/navigation';
import { useEffect, useTransition } from 'react';
import { refreshAndCheckAction } from '@/app/actions';

// This component uses the refreshInterval from settings to periodically
// call router.refresh(), which re-fetches and re-renders Server Components
// without a full page reload.
export function AutoRefresher({ intervalMinutes }: { intervalMinutes: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Ensure interval is at least 1 minute to avoid excessive requests.
    const effectiveIntervalMinutes = Math.max(intervalMinutes, 1);
    const intervalMs = effectiveIntervalMinutes * 60 * 1000;

    const intervalId = setInterval(() => {
      // Don't stack refreshes if one is already in progress.
      if (isPending) return;

      startTransition(async () => {
        // By explicitly invalidating the cache on the server before refreshing,
        // we ensure that router.refresh() fetches the newest data
        // instead of potentially serving a stale version while revalidating.
        await refreshAndCheckAction();
        router.refresh();
      });
    }, intervalMs);

    // Clean up the interval when the component unmounts or the interval changes.
    return () => clearInterval(intervalId);
  }, [intervalMinutes, router, isPending]);

  return null; // This component doesn't render any UI.
}

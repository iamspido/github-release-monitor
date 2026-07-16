"use client";

import * as React from "react";
import { getJobStatusAction } from "@/app/actions";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

type UseJobPollingOptions = {
  jobId: string | undefined;
  onComplete: () => void;
  onError: () => void;
  onTimeout: () => void;
  onDone: () => void;
  intervalMs?: number;
  timeoutMs?: number;
};

export function useJobPolling({
  jobId,
  onComplete,
  onError,
  onTimeout,
  onDone,
  intervalMs = 2000,
  timeoutMs = 5 * 60 * 1000,
}: UseJobPollingOptions) {
  React.useEffect(() => {
    if (!jobId) return;

    const startTime = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startTime > timeoutMs) {
        onTimeout();
        onDone();
        return;
      }

      try {
        const { status } = await getJobStatusAction(jobId);
        if (cancelled) return;

        if (status === "complete") {
          onComplete();
          onDone();
        } else if (status === "error") {
          onError();
          onDone();
        } else {
          timeoutId = setTimeout(poll, intervalMs);
        }
      } catch (error: unknown) {
        if (cancelled) return;
        if (reloadIfServerActionStale(error)) {
          return;
        }
        onError();
        onDone();
      }
    };

    timeoutId = setTimeout(poll, intervalMs);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [intervalMs, jobId, onComplete, onDone, onError, onTimeout, timeoutMs]);
}

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

    const intervalId = setInterval(async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        onTimeout();
        onDone();
        return;
      }

      try {
        const { status } = await getJobStatusAction(jobId);

        if (status === "complete") {
          clearInterval(intervalId);
          onComplete();
          onDone();
        } else if (status === "error") {
          clearInterval(intervalId);
          onError();
          onDone();
        }
      } catch (error: unknown) {
        clearInterval(intervalId);
        if (reloadIfServerActionStale(error)) {
          return;
        }
        onError();
        onDone();
      }
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [intervalMs, jobId, onComplete, onDone, onError, onTimeout, timeoutMs]);
}

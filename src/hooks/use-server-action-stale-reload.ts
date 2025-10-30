"use client";

import * as React from "react";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

export function useServerActionStaleReload(): void {
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let hasReloaded = false;

    const triggerReload = (reason: unknown) => {
      if (hasReloaded) return false;
      const shouldReload = reloadIfServerActionStale(reason);
      if (shouldReload) {
        hasReloaded = true;
        console.info(
          "[GitHub Release Monitor] Reloading due to stale server action",
          reason,
        );
      }
      return shouldReload;
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (triggerReload(event.reason)) {
        event.preventDefault();
      }
    };

    const handleError = (event: ErrorEvent) => {
      if (triggerReload(event.error ?? event.message)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);
}

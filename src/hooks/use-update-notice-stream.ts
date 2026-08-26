"use client";

import * as React from "react";
import type { UpdateNotificationState } from "@/types";

export function useUpdateNoticeStream(initialNotice?: UpdateNotificationState) {
  const [notice, setNotice] = React.useState(initialNotice);
  const hasLiveNoticeRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasLiveNoticeRef.current) setNotice(initialNotice);
  }, [initialNotice]);

  React.useEffect(() => {
    let source: EventSource | undefined;
    let isMounted = true;

    try {
      source = new EventSource("/api/update-notice/stream");
      source.addEventListener("update-notice-changed", (event) => {
        try {
          const result = JSON.parse(
            (event as MessageEvent).data,
          ) as UpdateNotificationState;
          if (isMounted) {
            hasLiveNoticeRef.current = true;
            setNotice(result);
          }
        } catch {
          // Ignore malformed events; the next keep-alive cycle reconnects.
        }
      });
      source.onerror = () => {
        // Do not close here: EventSource retries automatically. A manual
        // close would permanently disable live updates.
        if (source?.readyState === EventSource.CLOSED) source = undefined;
      };
    } catch {
      // EventSource not available – fall back to the initial server-rendered notice.
    }

    return () => {
      isMounted = false;
      source?.close();
    };
  }, []);

  return { notice };
}

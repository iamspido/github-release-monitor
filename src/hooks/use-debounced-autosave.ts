"use client";

import * as React from "react";

export type AutosaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "success"
  | "error"
  | "paused";

export interface AutosaveContext {
  isCurrent: () => boolean;
  setStatus: (status: AutosaveStatus) => boolean;
}

type AutosaveTask = (context: AutosaveContext) => Promise<void>;

/**
 * Owns the timer and revision lifecycle shared by autosaving forms.
 * Superseded timers and in-flight saves can still finish, but their context
 * can no longer update the current form state.
 */
export function useDebouncedAutosave(delayMs = 1500) {
  const [status, setStatus] = React.useState<AutosaveStatus>("idle");
  const revisionRef = React.useRef(0);

  const cancel = React.useCallback((nextStatus?: AutosaveStatus) => {
    revisionRef.current += 1;
    if (nextStatus) setStatus(nextStatus);
  }, []);

  const schedule = React.useCallback(
    (task: AutosaveTask) => {
      const revision = ++revisionRef.current;
      const isCurrent = () => revision === revisionRef.current;
      const setCurrentStatus = (nextStatus: AutosaveStatus) => {
        if (!isCurrent()) return false;
        setStatus(nextStatus);
        return true;
      };

      setStatus("waiting");
      const timer = window.setTimeout(async () => {
        if (!setCurrentStatus("saving")) return;
        await task({ isCurrent, setStatus: setCurrentStatus });
      }, delayMs);

      return () => {
        window.clearTimeout(timer);
        if (isCurrent()) revisionRef.current += 1;
      };
    },
    [delayMs],
  );

  return {
    status,
    setStatus,
    cancel,
    schedule,
  };
}

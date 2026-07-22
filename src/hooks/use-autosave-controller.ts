"use client";

import * as React from "react";

export type AutosaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "success"
  | "error"
  | "paused";

export type AutosaveTask = () => Promise<boolean>;

const DEFAULT_AUTOSAVE_DELAY_MS = 750;

export function useAutosaveController(delayMs = DEFAULT_AUTOSAVE_DELAY_MS) {
  const [status, setStatus] = React.useState<AutosaveStatus>("idle");
  const [hasPending, setHasPending] = React.useState(false);
  const mountedRef = React.useRef(true);
  const timerRef = React.useRef<number | null>(null);
  const pendingTaskRef = React.useRef<AutosaveTask | null>(null);
  const pendingDueAtRef = React.useRef<number | null>(null);
  const pendingImmediateRef = React.useRef(false);
  const inFlightRef = React.useRef(false);
  const pausedRef = React.useRef(false);
  const generationRef = React.useRef(0);

  const updateHasPending = React.useCallback(() => {
    if (!mountedRef.current) return;
    setHasPending(pendingTaskRef.current !== null || inFlightRef.current);
  }, []);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const runPendingRef = React.useRef<() => void>(() => {});

  const armPendingTimer = React.useCallback(() => {
    clearTimer();
    if (
      !mountedRef.current ||
      pausedRef.current ||
      inFlightRef.current ||
      pendingTaskRef.current === null
    ) {
      return;
    }

    if (pendingImmediateRef.current) {
      runPendingRef.current();
      return;
    }

    const remainingDelay = Math.max(
      0,
      (pendingDueAtRef.current ?? Date.now()) - Date.now(),
    );
    setStatus("waiting");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      runPendingRef.current();
    }, remainingDelay);
  }, [clearTimer]);

  const runPending = React.useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      inFlightRef.current ||
      pendingTaskRef.current === null
    ) {
      return;
    }

    clearTimer();
    const task = pendingTaskRef.current;
    const generation = generationRef.current;
    pendingTaskRef.current = null;
    pendingDueAtRef.current = null;
    pendingImmediateRef.current = false;
    inFlightRef.current = true;
    updateHasPending();
    setStatus("saving");

    void task()
      .then((success) => {
        inFlightRef.current = false;

        if (generation !== generationRef.current) {
          updateHasPending();
          armPendingTimer();
          return;
        }

        if (!success) {
          if (pendingTaskRef.current === null) {
            pendingTaskRef.current = task;
            pendingDueAtRef.current = Date.now() + delayMs;
            updateHasPending();
            if (mountedRef.current) {
              setStatus(pausedRef.current ? "paused" : "error");
            }
            return;
          }

          updateHasPending();
          if (pausedRef.current) setStatus("paused");
          else armPendingTimer();
          return;
        }

        updateHasPending();
        if (pendingTaskRef.current !== null) {
          if (pausedRef.current) setStatus("paused");
          else armPendingTimer();
        } else if (mountedRef.current) {
          setStatus(pausedRef.current ? "paused" : "success");
        }
      })
      .catch(() => {
        inFlightRef.current = false;
        if (generation !== generationRef.current) {
          updateHasPending();
          armPendingTimer();
          return;
        }
        if (pendingTaskRef.current === null) {
          pendingTaskRef.current = task;
          pendingDueAtRef.current = Date.now() + delayMs;
          updateHasPending();
          if (mountedRef.current) {
            setStatus(pausedRef.current ? "paused" : "error");
          }
          return;
        }

        updateHasPending();
        if (pausedRef.current) setStatus("paused");
        else armPendingTimer();
      });
  }, [armPendingTimer, clearTimer, delayMs, updateHasPending]);

  runPendingRef.current = runPending;

  const schedule = React.useCallback(
    (task: AutosaveTask) => {
      pendingTaskRef.current = task;
      pendingDueAtRef.current = Date.now() + delayMs;
      pendingImmediateRef.current = false;
      updateHasPending();

      if (pausedRef.current) {
        setStatus("paused");
        return;
      }

      armPendingTimer();
    },
    [armPendingTimer, delayMs, updateHasPending],
  );

  const saveNow = React.useCallback(
    (task: AutosaveTask) => {
      pendingTaskRef.current = task;
      pendingDueAtRef.current = Date.now();
      pendingImmediateRef.current = true;
      updateHasPending();

      if (pausedRef.current) {
        setStatus("paused");
        return;
      }

      runPending();
    },
    [runPending, updateHasPending],
  );

  const flush = React.useCallback(() => {
    if (pendingTaskRef.current === null) return;
    pendingDueAtRef.current = Date.now();
    pendingImmediateRef.current = true;
    if (pausedRef.current) {
      setStatus("paused");
      return;
    }
    runPending();
  }, [runPending]);

  const pause = React.useCallback(() => {
    pausedRef.current = true;
    clearTimer();
    if (!inFlightRef.current) setStatus("paused");
  }, [clearTimer]);

  const resume = React.useCallback(() => {
    pausedRef.current = false;
    if (pendingTaskRef.current !== null) {
      pendingImmediateRef.current = true;
      pendingDueAtRef.current = Date.now();
      runPending();
    } else if (!inFlightRef.current) {
      setStatus((current) => (current === "paused" ? "idle" : current));
    }
  }, [runPending]);

  const cancel = React.useCallback(
    (nextStatus: AutosaveStatus = "idle") => {
      generationRef.current += 1;
      clearTimer();
      pendingTaskRef.current = null;
      pendingDueAtRef.current = null;
      pendingImmediateRef.current = false;
      pausedRef.current = false;
      updateHasPending();
      setStatus(nextStatus);
    },
    [clearTimer, updateHasPending],
  );

  const discardPending = React.useCallback(
    (nextStatus: AutosaveStatus = "idle") => {
      clearTimer();
      pendingTaskRef.current = null;
      pendingDueAtRef.current = null;
      pendingImmediateRef.current = false;
      updateHasPending();
      if (!inFlightRef.current) setStatus(nextStatus);
    },
    [clearTimer, updateHasPending],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      clearTimer();
      pendingTaskRef.current = null;
      pendingDueAtRef.current = null;
      pendingImmediateRef.current = false;
    };
  }, [clearTimer]);

  return {
    status,
    setStatus,
    hasPending,
    schedule,
    saveNow,
    flush,
    pause,
    resume,
    cancel,
    discardPending,
  };
}

"use client";

import * as React from "react";

const minuteInMilliseconds = 60_000;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | undefined;
let currentTime = Date.now();

function emitTick() {
  currentTime = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    // The interval is stopped while unused, so refresh a potentially stale
    // snapshot before the first returning subscriber reads it.
    currentTime = Date.now();
  }
  listeners.add(listener);

  if (intervalId === undefined) {
    intervalId = setInterval(emitTick, minuteInMilliseconds);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };
}

function getSnapshot() {
  return currentTime;
}

function getServerSnapshot() {
  return 0;
}

export function useSharedMinuteTicker() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

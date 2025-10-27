"use client";

import * as React from "react";

type NetworkContextValue = { isOnline: boolean };

const NetworkContext = React.createContext<NetworkContextValue | undefined>(
  undefined,
);

type Subscriber = () => void;

let storeIsOnline = true;
const subscribers = new Set<Subscriber>();
let listenersInitialized = false;

function notifySubscribers(online: boolean) {
  if (storeIsOnline === online) {
    return;
  }
  storeIsOnline = online;
  for (const listener of subscribers) {
    listener();
  }
}

function initializeListeners() {
  if (listenersInitialized || typeof window === "undefined") {
    return;
  }

  const handleOnline = () => notifySubscribers(true);
  const handleOffline = () => notifySubscribers(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Do not trust navigator.onLine blindly in headless CI; default remains true
  // unless an event flips it.
  listenersInitialized = true;
}

if (typeof window !== "undefined") {
  initializeListeners();
}

function subscribeStore(listener: Subscriber): () => void {
  initializeListeners();
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function getClientSnapshot() {
  return storeIsOnline;
}

function getServerSnapshot() {
  return true;
}

function useNetworkStore(): NetworkContextValue {
  const isOnline = React.useSyncExternalStore(
    subscribeStore,
    getClientSnapshot,
    getServerSnapshot,
  );
  return { isOnline };
}

export function NetworkStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useNetworkStore();
  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetworkStatus() {
  const ctx = React.useContext(NetworkContext);
  if (!ctx) return { isOnline: true };
  return ctx;
}

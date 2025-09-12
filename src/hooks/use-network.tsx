'use client';

import * as React from 'react';

type NetworkContextValue = { isOnline: boolean };

const NetworkContext = React.createContext<NetworkContextValue | undefined>(undefined);

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  // Optimistic: assume online until the browser tells us otherwise.
  // This avoids false negatives in headless/CI where navigator.onLine can be unreliable.
  const [isOnline, setIsOnline] = React.useState<boolean>(true);

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkStatus() {
  const ctx = React.useContext(NetworkContext);
  if (!ctx) return { isOnline: true };
  return ctx;
}

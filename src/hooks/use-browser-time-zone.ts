"use client";

import * as React from "react";

export function useBrowserTimeZone(): string | null {
  const [timeZone, setTimeZone] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      setTimeZone("UTC");
    }
  }, []);

  return timeZone;
}

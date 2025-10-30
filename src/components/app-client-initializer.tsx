"use client";

import type { ReactElement, ReactNode } from "react";
import { useServerActionStaleReload } from "@/hooks/use-server-action-stale-reload";

export function AppClientInitializer({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  useServerActionStaleReload();
  return <>{children}</>;
}

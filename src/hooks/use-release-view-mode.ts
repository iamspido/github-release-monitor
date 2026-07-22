"use client";

import * as React from "react";
import {
  RELEASE_VIEW_MODE_COOKIE,
  RELEASE_VIEW_MODE_COOKIE_MAX_AGE,
  type ReleaseViewMode,
} from "@/lib/release-view-mode";

export function useReleaseViewMode(initialViewMode: ReleaseViewMode) {
  const [viewMode, setViewMode] =
    React.useState<ReleaseViewMode>(initialViewMode);

  const updateViewMode = React.useCallback((nextViewMode: ReleaseViewMode) => {
    setViewMode(nextViewMode);
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      // biome-ignore lint/suspicious/noDocumentCookie: this non-sensitive preference must be available synchronously on the next server render.
      document.cookie = `${RELEASE_VIEW_MODE_COOKIE}=${nextViewMode}; Path=/; Max-Age=${RELEASE_VIEW_MODE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    } catch {
      // The view still changes for this session when persistence is unavailable.
    }
  }, []);

  return { updateViewMode, viewMode };
}

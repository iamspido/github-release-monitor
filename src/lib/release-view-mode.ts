export const releaseViewModes = ["cards", "compact"] as const;
export type ReleaseViewMode = (typeof releaseViewModes)[number];

export const RELEASE_VIEW_MODE_COOKIE = "grm_release_view_mode";
export const RELEASE_VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeReleaseViewMode(value: unknown): ReleaseViewMode {
  return releaseViewModes.includes(value as ReleaseViewMode)
    ? (value as ReleaseViewMode)
    : "cards";
}

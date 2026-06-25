import { areArraysEqualIgnoringOrder } from "@/lib/settings/change-detection";
import type { Repository } from "@/types";

export type RegexValidationError = "invalid" | null;

export function validateRegexInput(value: string): RegexValidationError {
  if (!value.trim()) return null;

  try {
    new RegExp(value);
    return null;
  } catch {
    return "invalid";
  }
}

export function areSettingsSnapshotsEqual<T>(previous: T, next: T) {
  return JSON.stringify(previous) === JSON.stringify(next);
}

export type RefreshSensitiveRepoSettings = Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "releasesPerPage"
  | "includeRegex"
  | "excludeRegex"
>;

export function hasRefreshSensitiveRepoSettingChanges(
  previous: RefreshSensitiveRepoSettings,
  next: RefreshSensitiveRepoSettings,
) {
  const filtersChanged =
    (previous.includeRegex ?? "").trim() !== (next.includeRegex ?? "").trim() ||
    (previous.excludeRegex ?? "").trim() !== (next.excludeRegex ?? "").trim();
  const channelsChanged = !areArraysEqualIgnoringOrder(
    previous.releaseChannels,
    next.releaseChannels,
  );
  const preReleaseSubChannelsChanged = !areArraysEqualIgnoringOrder(
    previous.preReleaseSubChannels,
    next.preReleaseSubChannels,
  );
  const releasesPerPageChanged =
    previous.releasesPerPage !== next.releasesPerPage;

  return (
    filtersChanged ||
    channelsChanged ||
    preReleaseSubChannelsChanged ||
    releasesPerPageChanged
  );
}

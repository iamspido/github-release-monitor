import {
  getInvalidCustomPreReleaseMarkers,
  parseCustomPreReleaseMarkers,
  splitCustomPreReleaseMarkerInput,
} from "@/lib/releases/pre-release-markers";
import { areArraysEqualIgnoringOrder } from "@/lib/settings/change-detection";
import { isValidFiveFieldCron } from "@/lib/settings/schedule-fields";
import type { Repository } from "@/types";

export type RegexValidationError = "invalid" | null;
export type RangeValidationError = "too_low" | "too_high" | null;
export type IntegerValidationError =
  | Exclude<RangeValidationError, null>
  | "invalid"
  | null;
export type CronValidationError = "invalid" | null;

export { parseCustomPreReleaseMarkers };

export function validateCustomPreReleaseMarkersInput(value: string): string[] {
  return getInvalidCustomPreReleaseMarkers(
    splitCustomPreReleaseMarkerInput(value),
  );
}

export function validateRegexInput(value: string): RegexValidationError {
  if (!value.trim()) return null;

  try {
    new RegExp(value);
    return null;
  } catch {
    return "invalid";
  }
}

export function validateNumberRange(
  value: number,
  min: number,
  max: number,
): RangeValidationError {
  if (value < min) return "too_low";
  if (value > max) return "too_high";
  return null;
}

export function validateOptionalIntegerInput(
  value: string | number,
  min: number,
  max: number,
): IntegerValidationError {
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return "invalid";

  return validateNumberRange(parsed, min, max);
}

export function validateFilledInterval(
  value: number,
  fieldsFilled: boolean,
  max: number,
): RangeValidationError {
  return fieldsFilled ? validateNumberRange(value, 1, max) : null;
}

export function validateCronInput(
  value: string | null | undefined,
  enabled: boolean,
): CronValidationError {
  if (!enabled) return null;
  return isValidFiveFieldCron(value ?? "") ? null : "invalid";
}

export function isCacheIntervalInvalid({
  enabled,
  fieldsFilled,
  cacheInterval,
  refreshInterval,
}: {
  enabled: boolean;
  fieldsFilled: boolean;
  cacheInterval: number;
  refreshInterval: number;
}): boolean {
  return (
    enabled &&
    fieldsFilled &&
    cacheInterval > 0 &&
    cacheInterval > refreshInterval
  );
}

export function areSettingsSnapshotsEqual<T>(previous: T, next: T) {
  return JSON.stringify(previous) === JSON.stringify(next);
}

export function hasSettingsSnapshotDrift<T>(
  persisted: T,
  submitted: T,
  next: T,
) {
  return (
    !areSettingsSnapshotsEqual(persisted, next) ||
    !areSettingsSnapshotsEqual(submitted, next)
  );
}

export function getSettingsReconciliationPatch<T extends object>(
  persisted: T,
  submitted: T,
  next: T,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (
      !areSettingsSnapshotsEqual(persisted[key], next[key]) ||
      !areSettingsSnapshotsEqual(submitted[key], next[key])
    ) {
      patch[key] = next[key];
    }
  }
  return patch;
}

export type RefreshSensitiveRepoSettings = Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "customPreReleaseMarkers"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
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
  const customPreReleaseMarkersChanged = !areArraysEqualIgnoringOrder(
    previous.customPreReleaseMarkers,
    next.customPreReleaseMarkers,
  );
  const releasesPerPageChanged =
    previous.releasesPerPage !== next.releasesPerPage;
  const releaseSelectionStrategyChanged =
    previous.releaseSelectionStrategy !== next.releaseSelectionStrategy;
  const versionTagPatternChanged =
    (previous.versionTagPattern ?? "").trim() !==
    (next.versionTagPattern ?? "").trim();

  return (
    filtersChanged ||
    channelsChanged ||
    preReleaseSubChannelsChanged ||
    customPreReleaseMarkersChanged ||
    releaseSelectionStrategyChanged ||
    versionTagPatternChanged ||
    releasesPerPageChanged
  );
}

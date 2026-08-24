import {
  normalizeProviderSortOrder,
  normalizeReleaseSortOrder,
} from "@/lib/release-sort";
import {
  getInvalidCustomPreReleaseMarkers,
  normalizeCustomPreReleaseMarkers,
} from "@/lib/releases/pre-release-markers";
import { normalizeReleaseSelectionStrategy } from "@/lib/releases/selection";
import { normalizeBackgroundCheckCron } from "@/lib/runtime/repository-schedule";
import {
  getInvalidCustomSecurityPattern,
  normalizeSecurityHighlightColorPreset,
  normalizeSecurityHighlightCustomColor,
} from "@/lib/security-release";
import {
  buildGlobalSettingsChangeLog,
  getGlobalReleaseCacheInvalidationChanges,
  shouldInvalidateReleaseCache,
} from "@/lib/settings/change-detection";
import { validateRegexInput } from "@/lib/settings/form-model";
import { normalizeSettings } from "@/lib/storage/settings";
import type { AppSettings } from "@/types";

export type SettingsValidationErrorKey =
  | "cron_error_invalid"
  | "custom_prerelease_markers_error_invalid"
  | "regex_error_invalid"
  | "security_patterns_error_invalid";

export type PreparedSettingsUpdate = {
  settingsToSave: AppSettings;
  releaseCacheInvalidation: ReturnType<
    typeof getGlobalReleaseCacheInvalidationChanges
  >;
  changes: string[];
  shouldResetNewFlags: boolean;
  shouldClearEtags: boolean;
  shouldRebaselineReleaseSelection: boolean;
};

export function prepareSettingsUpdate(
  incomingSettings: AppSettings | Partial<AppSettings>,
  currentSettings: AppSettings,
  mergeWithCurrent: boolean,
):
  | { ok: true; value: PreparedSettingsUpdate }
  | {
      ok: false;
      errorKey: SettingsValidationErrorKey;
      locale: AppSettings["locale"];
      errorValues?: string[];
    } {
  const settingsCandidate = mergeWithCurrent
    ? { ...currentSettings, ...incomingSettings }
    : incomingSettings;
  const invalidCustomPreReleaseMarkers = getInvalidCustomPreReleaseMarkers(
    settingsCandidate.customPreReleaseMarkers,
  );
  if (invalidCustomPreReleaseMarkers.length > 0) {
    return {
      ok: false,
      errorKey: "custom_prerelease_markers_error_invalid",
      locale: currentSettings.locale,
      errorValues: invalidCustomPreReleaseMarkers,
    };
  }
  const newSettings = normalizeSettings(settingsCandidate);
  const releaseCacheInvalidation = getGlobalReleaseCacheInvalidationChanges(
    currentSettings,
    newSettings,
  );
  const incomingCron = (newSettings.backgroundCheckCron ?? "").trim();
  const sanitizedBackgroundCheckCron = incomingCron
    ? normalizeBackgroundCheckCron(incomingCron)
    : undefined;
  if (incomingCron && !sanitizedBackgroundCheckCron) {
    return {
      ok: false,
      errorKey: "cron_error_invalid",
      locale: newSettings.locale,
    };
  }

  const hasInvalidReleaseRegex = [
    newSettings.includeRegex,
    newSettings.excludeRegex,
  ].some(
    (value) => typeof value === "string" && validateRegexInput(value) !== null,
  );
  if (hasInvalidReleaseRegex) {
    return {
      ok: false,
      errorKey: "regex_error_invalid",
      locale: newSettings.locale,
    };
  }
  if (getInvalidCustomSecurityPattern(newSettings.customSecurityPatterns)) {
    return {
      ok: false,
      errorKey: "security_patterns_error_invalid",
      locale: newSettings.locale,
    };
  }

  const incomingParallelFetches = Number.isFinite(
    newSettings.parallelRepoFetches,
  )
    ? Math.round(newSettings.parallelRepoFetches)
    : currentSettings.parallelRepoFetches;
  const fallbackParallelFetches = Number.isFinite(incomingParallelFetches)
    ? incomingParallelFetches
    : currentSettings.parallelRepoFetches;
  const normalizedParallelFetches = Number.isFinite(fallbackParallelFetches)
    ? fallbackParallelFetches
    : 1;

  const settingsToSave: AppSettings = {
    ...newSettings,
    refreshInterval: Math.min(
      Math.max(1, Math.round(newSettings.refreshInterval)),
      5_256_000,
    ),
    cacheInterval: Math.min(
      Math.max(0, Math.round(newSettings.cacheInterval)),
      5_256_000,
    ),
    backgroundCheckCron: sanitizedBackgroundCheckCron,
    releasesPerPage: Math.min(
      Math.max(1, Math.round(newSettings.releasesPerPage)),
      1000,
    ),
    parallelRepoFetches: Math.min(Math.max(normalizedParallelFetches, 1), 50),
    customPreReleaseMarkers: normalizeCustomPreReleaseMarkers(
      newSettings.customPreReleaseMarkers,
    ),
    includeRegex: newSettings.includeRegex?.trim() || undefined,
    excludeRegex: newSettings.excludeRegex?.trim() || undefined,
    appriseTags: newSettings.appriseTags?.trim() || undefined,
    appriseMaxCharacters: Math.max(
      0,
      Math.round(newSettings.appriseMaxCharacters ?? 1800),
    ),
    notificationMaxMessagesPerRun: Math.min(
      Math.max(0, Math.round(newSettings.notificationMaxMessagesPerRun ?? 20)),
      10_000,
    ),
    notificationDeliveryConcurrency: Math.min(
      Math.max(1, Math.round(newSettings.notificationDeliveryConcurrency ?? 4)),
      50,
    ),
    releaseSortOrder: normalizeReleaseSortOrder(newSettings.releaseSortOrder),
    releaseSelectionStrategy: normalizeReleaseSelectionStrategy(
      newSettings.releaseSelectionStrategy,
    ),
    providerSortOrder: normalizeProviderSortOrder(
      newSettings.providerSortOrder,
    ),
    securityHighlightColorPreset: normalizeSecurityHighlightColorPreset(
      newSettings.securityHighlightColorPreset,
    ),
    securityHighlightCustomColor: normalizeSecurityHighlightCustomColor(
      newSettings.securityHighlightCustomColor,
    ),
    customSecurityPatterns:
      newSettings.customSecurityPatterns?.trim() || undefined,
    includeDefaultSecurityPatterns:
      newSettings.includeDefaultSecurityPatterns !== false,
    confirmSecurityAcknowledge: newSettings.confirmSecurityAcknowledge === true,
  };

  return {
    ok: true,
    value: {
      settingsToSave,
      releaseCacheInvalidation,
      changes: buildGlobalSettingsChangeLog(currentSettings, settingsToSave),
      shouldResetNewFlags:
        Boolean(currentSettings.showAcknowledge) &&
        settingsToSave.showAcknowledge === false,
      shouldClearEtags: shouldInvalidateReleaseCache(releaseCacheInvalidation),
      shouldRebaselineReleaseSelection:
        releaseCacheInvalidation.releaseSelectionStrategyChanged === true,
    },
  };
}

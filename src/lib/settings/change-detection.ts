import type { AppSettings, Repository } from "@/types";

type ArrayCompareOptions = {
  emptyAsUndefined?: boolean;
};

export type ReleaseCacheInvalidationChanges = {
  filtersChanged?: boolean;
  releaseChannelsChanged?: boolean;
  preReleaseSubChannelsChanged?: boolean;
  customPreReleaseMarkersChanged?: boolean;
  releasesPerPageChanged?: boolean;
  releaseSelectionStrategyChanged?: boolean;
  versionTagPatternChanged?: boolean;
};

function normalizeComparableArray<T>(
  value: T[] | null | undefined,
  options: ArrayCompareOptions = {},
): T[] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value.length === 0) {
    return options.emptyAsUndefined ? undefined : [];
  }

  return [...value].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function areArraysEqualIgnoringOrder<T>(
  previous: T[] | null | undefined,
  next: T[] | null | undefined,
  options: ArrayCompareOptions = {},
): boolean {
  const normalizedPrevious = normalizeComparableArray(previous, options);
  const normalizedNext = normalizeComparableArray(next, options);
  return JSON.stringify(normalizedPrevious) === JSON.stringify(normalizedNext);
}

export function formatChangeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

export function pushValueChange(
  changes: string[],
  label: string,
  previous: unknown,
  next: unknown,
): void {
  if (!Object.is(previous, next)) {
    changes.push(
      `${label}: ${formatChangeValue(previous)} -> ${formatChangeValue(next)}`,
    );
  }
}

export function pushArrayChange<T>(
  changes: string[],
  label: string,
  previous: T[] | null | undefined,
  next: T[] | null | undefined,
  options: ArrayCompareOptions = {},
): void {
  if (!areArraysEqualIgnoringOrder(previous, next, options)) {
    changes.push(
      `${label}: ${formatChangeValue(previous)} -> ${formatChangeValue(next)}`,
    );
  }
}

function pushOrderedArrayChange<T>(
  changes: string[],
  label: string,
  previous: T[] | null | undefined,
  next: T[] | null | undefined,
  options: ArrayCompareOptions = {},
): void {
  const normalizedPrevious =
    !previous || previous.length === 0
      ? options.emptyAsUndefined
        ? undefined
        : []
      : previous;
  const normalizedNext =
    !next || next.length === 0
      ? options.emptyAsUndefined
        ? undefined
        : []
      : next;

  if (JSON.stringify(normalizedPrevious) !== JSON.stringify(normalizedNext)) {
    changes.push(
      `${label}: ${formatChangeValue(previous)} -> ${formatChangeValue(next)}`,
    );
  }
}

export function getReleaseCacheInvalidationReasons(
  changes: ReleaseCacheInvalidationChanges,
  options: { filtersReason?: string } = {},
): string[] {
  const reasons: string[] = [];

  if (changes.filtersChanged) {
    reasons.push(options.filtersReason ?? "filtersChanged");
  }
  if (changes.releaseChannelsChanged) {
    reasons.push("releaseChannelsChanged");
  }
  if (changes.preReleaseSubChannelsChanged) {
    reasons.push("preReleaseSubChannelsChanged");
  }
  if (changes.customPreReleaseMarkersChanged) {
    reasons.push("customPreReleaseMarkersChanged");
  }
  if (changes.releasesPerPageChanged) {
    reasons.push("releasesPerPageChanged");
  }
  if (changes.releaseSelectionStrategyChanged) {
    reasons.push("releaseSelectionStrategyChanged");
  }
  if (changes.versionTagPatternChanged) {
    reasons.push("versionTagPatternChanged");
  }

  return reasons;
}

export function shouldInvalidateReleaseCache(
  changes: ReleaseCacheInvalidationChanges,
): boolean {
  return getReleaseCacheInvalidationReasons(changes).length > 0;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | undefined {
  return value?.trim() || undefined;
}

export function getGlobalReleaseCacheInvalidationChanges(
  previous: AppSettings,
  next: AppSettings,
): ReleaseCacheInvalidationChanges {
  return {
    filtersChanged:
      normalizeOptionalText(previous.includeRegex) !==
        normalizeOptionalText(next.includeRegex) ||
      normalizeOptionalText(previous.excludeRegex) !==
        normalizeOptionalText(next.excludeRegex),
    releaseChannelsChanged: !areArraysEqualIgnoringOrder(
      previous.releaseChannels,
      next.releaseChannels,
    ),
    preReleaseSubChannelsChanged: !areArraysEqualIgnoringOrder(
      previous.preReleaseSubChannels,
      next.preReleaseSubChannels,
    ),
    customPreReleaseMarkersChanged: !areArraysEqualIgnoringOrder(
      previous.customPreReleaseMarkers,
      next.customPreReleaseMarkers,
    ),
    releasesPerPageChanged: previous.releasesPerPage !== next.releasesPerPage,
    releaseSelectionStrategyChanged:
      (previous.releaseSelectionStrategy ?? "newest") !==
      (next.releaseSelectionStrategy ?? "newest"),
  };
}

export function buildGlobalSettingsChangeLog(
  previous: AppSettings,
  next: AppSettings,
): string[] {
  const changes: string[] = [];

  pushValueChange(changes, "timeFormat", previous.timeFormat, next.timeFormat);
  pushValueChange(changes, "locale", previous.locale, next.locale);
  pushValueChange(
    changes,
    "refreshInterval",
    previous.refreshInterval,
    next.refreshInterval,
  );
  pushValueChange(
    changes,
    "cacheInterval",
    previous.cacheInterval,
    next.cacheInterval,
  );
  pushValueChange(
    changes,
    "backgroundCheckCron",
    previous.backgroundCheckCron,
    next.backgroundCheckCron,
  );
  pushValueChange(
    changes,
    "releasesPerPage",
    previous.releasesPerPage,
    next.releasesPerPage,
  );
  pushValueChange(
    changes,
    "parallelRepoFetches",
    previous.parallelRepoFetches,
    next.parallelRepoFetches,
  );
  pushArrayChange(
    changes,
    "releaseChannels",
    previous.releaseChannels,
    next.releaseChannels,
  );
  pushValueChange(
    changes,
    "releaseSelectionStrategy",
    previous.releaseSelectionStrategy ?? "newest",
    next.releaseSelectionStrategy ?? "newest",
  );
  pushArrayChange(
    changes,
    "preReleaseSubChannels",
    previous.preReleaseSubChannels,
    next.preReleaseSubChannels,
  );
  pushArrayChange(
    changes,
    "customPreReleaseMarkers",
    previous.customPreReleaseMarkers,
    next.customPreReleaseMarkers,
  );
  pushValueChange(
    changes,
    "releaseSortOrder",
    previous.releaseSortOrder,
    next.releaseSortOrder,
  );
  pushArrayChange(
    changes,
    "providerSortOrder",
    previous.providerSortOrder,
    next.providerSortOrder,
  );
  pushValueChange(
    changes,
    "prioritizeNewSecurityReleases",
    previous.prioritizeNewSecurityReleases,
    next.prioritizeNewSecurityReleases,
  );
  pushValueChange(
    changes,
    "securityHighlightColorPreset",
    previous.securityHighlightColorPreset,
    next.securityHighlightColorPreset,
  );
  pushValueChange(
    changes,
    "securityHighlightCustomColor",
    previous.securityHighlightCustomColor,
    next.securityHighlightCustomColor,
  );
  pushValueChange(
    changes,
    "confirmSecurityAcknowledge",
    previous.confirmSecurityAcknowledge,
    next.confirmSecurityAcknowledge,
  );
  pushValueChange(
    changes,
    "includeDefaultSecurityPatterns",
    previous.includeDefaultSecurityPatterns,
    next.includeDefaultSecurityPatterns,
  );
  pushValueChange(
    changes,
    "customSecurityPatterns",
    previous.customSecurityPatterns,
    next.customSecurityPatterns,
  );
  pushValueChange(
    changes,
    "showAcknowledge",
    previous.showAcknowledge,
    next.showAcknowledge,
  );
  pushValueChange(
    changes,
    "showMarkAsNew",
    previous.showMarkAsNew,
    next.showMarkAsNew,
  );
  pushValueChange(
    changes,
    "showProviderPrefixInRepoId",
    previous.showProviderPrefixInRepoId,
    next.showProviderPrefixInRepoId,
  );
  pushValueChange(
    changes,
    "showProviderDomainInRepoId",
    previous.showProviderDomainInRepoId,
    next.showProviderDomainInRepoId,
  );
  pushValueChange(
    changes,
    "repositoryFormExpanded",
    previous.repositoryFormExpanded,
    next.repositoryFormExpanded,
  );
  pushValueChange(
    changes,
    "includeRegex",
    previous.includeRegex,
    next.includeRegex,
  );
  pushValueChange(
    changes,
    "excludeRegex",
    previous.excludeRegex,
    next.excludeRegex,
  );
  pushValueChange(
    changes,
    "emailIncludeReleaseNotes",
    previous.emailIncludeReleaseNotes,
    next.emailIncludeReleaseNotes,
  );
  pushValueChange(
    changes,
    "emailNotificationMode",
    previous.emailNotificationMode,
    next.emailNotificationMode,
  );
  pushValueChange(
    changes,
    "appriseIncludeReleaseNotes",
    previous.appriseIncludeReleaseNotes,
    next.appriseIncludeReleaseNotes,
  );
  pushValueChange(
    changes,
    "appriseNotificationMode",
    previous.appriseNotificationMode,
    next.appriseNotificationMode,
  );
  pushValueChange(
    changes,
    "notificationMaxMessagesPerRun",
    previous.notificationMaxMessagesPerRun,
    next.notificationMaxMessagesPerRun,
  );
  pushValueChange(
    changes,
    "notificationDeliveryConcurrency",
    previous.notificationDeliveryConcurrency,
    next.notificationDeliveryConcurrency,
  );
  pushValueChange(
    changes,
    "appriseMaxCharacters",
    previous.appriseMaxCharacters,
    next.appriseMaxCharacters,
  );
  pushValueChange(
    changes,
    "appriseTags",
    previous.appriseTags,
    next.appriseTags,
  );
  pushValueChange(
    changes,
    "appriseFormat",
    previous.appriseFormat,
    next.appriseFormat,
  );

  return changes;
}

export type RepositorySettingsUpdate = Pick<
  Repository,
  | "displayName"
  | "isPinned"
  | "tags"
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "customPreReleaseMarkers"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
  | "releasesPerPage"
  | "refreshInterval"
  | "cacheInterval"
  | "backgroundCheckCron"
  | "includeRegex"
  | "excludeRegex"
  | "appriseTags"
  | "appriseFormat"
>;

export type NormalizedRepositoryScheduleSettings = Pick<
  Repository,
  "refreshInterval" | "cacheInterval" | "backgroundCheckCron"
>;

export function getRepositoryReleaseCacheInvalidationChanges(
  previous: Repository,
  next: RepositorySettingsUpdate,
): ReleaseCacheInvalidationChanges {
  return {
    filtersChanged:
      normalizeOptionalText(previous.includeRegex) !==
        normalizeOptionalText(next.includeRegex) ||
      normalizeOptionalText(previous.excludeRegex) !==
        normalizeOptionalText(next.excludeRegex),
    releaseChannelsChanged: !areArraysEqualIgnoringOrder(
      previous.releaseChannels,
      next.releaseChannels,
      { emptyAsUndefined: true },
    ),
    preReleaseSubChannelsChanged: !areArraysEqualIgnoringOrder(
      previous.preReleaseSubChannels,
      next.preReleaseSubChannels,
    ),
    customPreReleaseMarkersChanged: !areArraysEqualIgnoringOrder(
      previous.customPreReleaseMarkers,
      next.customPreReleaseMarkers,
    ),
    releasesPerPageChanged:
      (previous.releasesPerPage ?? undefined) !==
      (next.releasesPerPage ?? undefined),
    releaseSelectionStrategyChanged:
      (previous.releaseSelectionStrategy ?? undefined) !==
      (next.releaseSelectionStrategy ?? undefined),
    versionTagPatternChanged:
      normalizeOptionalText(previous.versionTagPattern) !==
      normalizeOptionalText(next.versionTagPattern),
  };
}

export function buildRepositorySettingsChangeLog(
  previous: Repository,
  next: RepositorySettingsUpdate,
  normalizedSchedule: NormalizedRepositoryScheduleSettings,
): string[] {
  const changes: string[] = [];
  const nextInclude = normalizeOptionalText(next.includeRegex);
  const nextExclude = normalizeOptionalText(next.excludeRegex);
  const previousInclude = normalizeOptionalText(previous.includeRegex);
  const previousExclude = normalizeOptionalText(previous.excludeRegex);

  pushValueChange(
    changes,
    "displayName",
    normalizeOptionalText(previous.displayName),
    normalizeOptionalText(next.displayName),
  );
  pushValueChange(
    changes,
    "isPinned",
    previous.isPinned === true,
    next.isPinned === true,
  );

  pushOrderedArrayChange(changes, "tags", previous.tags, next.tags, {
    emptyAsUndefined: true,
  });

  pushArrayChange(
    changes,
    "releaseChannels",
    previous.releaseChannels,
    next.releaseChannels,
    { emptyAsUndefined: true },
  );
  pushArrayChange(
    changes,
    "customPreReleaseMarkers",
    previous.customPreReleaseMarkers,
    next.customPreReleaseMarkers,
  );
  pushArrayChange(
    changes,
    "preReleaseSubChannels",
    previous.preReleaseSubChannels,
    next.preReleaseSubChannels,
  );
  pushValueChange(
    changes,
    "releaseSelectionStrategy",
    previous.releaseSelectionStrategy ?? undefined,
    next.releaseSelectionStrategy ?? undefined,
  );
  pushValueChange(
    changes,
    "versionTagPattern",
    normalizeOptionalText(previous.versionTagPattern),
    normalizeOptionalText(next.versionTagPattern),
  );
  pushValueChange(
    changes,
    "releasesPerPage",
    previous.releasesPerPage ?? undefined,
    next.releasesPerPage ?? undefined,
  );
  pushValueChange(
    changes,
    "refreshInterval",
    previous.refreshInterval ?? null,
    normalizedSchedule.refreshInterval ?? null,
  );
  pushValueChange(
    changes,
    "cacheInterval",
    previous.cacheInterval ?? null,
    normalizedSchedule.cacheInterval ?? null,
  );
  pushValueChange(
    changes,
    "backgroundCheckCron",
    previous.backgroundCheckCron ?? undefined,
    normalizedSchedule.backgroundCheckCron ?? undefined,
  );
  pushValueChange(changes, "includeRegex", previousInclude, nextInclude);
  pushValueChange(changes, "excludeRegex", previousExclude, nextExclude);
  pushValueChange(
    changes,
    "appriseTags",
    previous.appriseTags ?? undefined,
    next.appriseTags ?? undefined,
  );
  pushValueChange(
    changes,
    "appriseFormat",
    previous.appriseFormat ?? undefined,
    next.appriseFormat ?? undefined,
  );

  return changes;
}

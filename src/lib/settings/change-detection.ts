type ArrayCompareOptions = {
  emptyAsUndefined?: boolean;
};

export type ReleaseCacheInvalidationChanges = {
  filtersChanged?: boolean;
  releaseChannelsChanged?: boolean;
  preReleaseSubChannelsChanged?: boolean;
  releasesPerPageChanged?: boolean;
};

function normalizeComparableArray<T>(
  value: T[] | null | undefined,
  options: ArrayCompareOptions = {},
): T[] | undefined {
  if (!value || value.length === 0) {
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
  if (changes.releasesPerPageChanged) {
    reasons.push("releasesPerPageChanged");
  }

  return reasons;
}

export function shouldInvalidateReleaseCache(
  changes: ReleaseCacheInvalidationChanges,
): boolean {
  return getReleaseCacheInvalidationReasons(changes).length > 0;
}

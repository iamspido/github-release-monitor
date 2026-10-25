import {
  getInvalidCustomPreReleaseMarkers,
  legacyPreReleaseMarkers,
  migrateLegacyPreReleaseConfiguration,
  normalizeCustomPreReleaseMarkers,
} from "@/lib/releases/pre-release-markers";
import {
  type VersionTagPatternValidationError,
  validateVersionTagPattern,
} from "@/lib/releases/version-tag-pattern";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { keepsStoredPattern } from "@/lib/settings/form-model";
import {
  normalizePatternInput,
  regexFilterError,
  type UntrustedPatternError,
} from "@/lib/untrusted-pattern";
import type {
  AppriseFormat,
  CachedRelease,
  ReleaseChannel,
  ReleaseSelectionStrategy,
  Repository,
} from "@/types";
import {
  allPreReleaseTypes,
  releaseSelectionStrategies as supportedReleaseSelectionStrategies,
} from "@/types";

const releaseChannels = new Set<ReleaseChannel>([
  "stable",
  "prerelease",
  "draft",
]);
const preReleaseChannels = new Set<string>([
  ...allPreReleaseTypes,
  ...legacyPreReleaseMarkers,
]);
const appriseFormats = new Set<AppriseFormat>(["text", "markdown", "html"]);
const releaseSelectionStrategies = new Set<ReleaseSelectionStrategy>(
  supportedReleaseSelectionStrategies,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof source[key] === "string" ? source[key] : undefined;
}

function readOptionalNullableString(
  source: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return isNullableString(source[key]) ? source[key] : undefined;
}

function readOptionalNullableFiniteNumber(
  source: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const value = source[key];
  return value === null || (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined;
}

function parseCachedRelease(value: unknown): CachedRelease | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.html_url !== "string" ||
    typeof value.tag_name !== "string" ||
    typeof value.created_at !== "string"
  ) {
    return undefined;
  }

  const release: CachedRelease = {
    html_url: value.html_url,
    tag_name: value.tag_name,
    created_at: value.created_at,
    // Legacy v2 exports may omit these fields even though current releases
    // always include them. Preserve that accepted shape during import.
    name: null,
    body: null,
    published_at: null,
  };
  const name = readOptionalNullableString(value, "name");
  if (name !== undefined) release.name = name;
  const body = readOptionalNullableString(value, "body");
  if (body !== undefined) release.body = body;
  const publishedAt = readOptionalNullableString(value, "published_at");
  if (publishedAt !== undefined) release.published_at = publishedAt;
  if (typeof value.published_at_unknown === "boolean") {
    release.published_at_unknown = value.published_at_unknown;
  }
  if (typeof value.fetched_at === "string") {
    release.fetched_at = value.fetched_at;
  }
  if (value.source === "release" || value.source === "tag") {
    release.source = value.source;
  }
  return release;
}

function readEnumArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] | undefined {
  return Array.isArray(value) && value.every((entry) => allowed.has(entry as T))
    ? [...value]
    : undefined;
}

export type ImportedPatternProblem =
  | { field: "include" | "exclude"; error: UntrustedPatternError }
  | {
      field: "version";
      error: Exclude<VersionTagPatternValidationError, null>;
    };

/** The first pattern the save refuses, skipping one kept as stored. */
export function findImportedPatternProblem(
  value: unknown,
  stored?: Pick<
    Repository,
    "includeRegex" | "excludeRegex" | "versionTagPattern"
  >,
): ImportedPatternProblem | null {
  if (!isRecord(value)) return null;
  const toCheck = (
    key: "includeRegex" | "excludeRegex" | "versionTagPattern",
  ): string | undefined => {
    const imported = readOptionalString(value, key);
    return stored && keepsStoredPattern(imported, stored[key])
      ? undefined
      : imported;
  };
  for (const [key, field] of [
    ["includeRegex", "include"],
    ["excludeRegex", "exclude"],
  ] as const) {
    const error = regexFilterError(toCheck(key));
    if (error) return { field, error };
  }
  const versionError = validateVersionTagPattern(toCheck("versionTagPattern"));
  return versionError ? { field: "version", error: versionError } : null;
}

/**
 * Parses the public v2 repository export shape at the server boundary.
 * Unknown fields and delivery bookkeeping are intentionally not copied.
 */
export function parseImportedRepository(value: unknown): Repository | null {
  if (!isRecord(value) || typeof value.url !== "string") return null;
  const parsedUrl = parseSupportedRepoUrl(value.url);
  if (!parsedUrl) return null;

  const repository: Repository = {
    id: parsedUrl.id,
    url: parsedUrl.canonicalRepoUrl,
  };

  const importedDisplayName = normalizeRepositoryDisplayName(value.displayName);
  if (importedDisplayName.success && importedDisplayName.displayName) {
    repository.displayName = importedDisplayName.displayName;
  }

  const lastSeenReleaseTag = readOptionalString(value, "lastSeenReleaseTag");
  if (lastSeenReleaseTag !== undefined) {
    repository.lastSeenReleaseTag = lastSeenReleaseTag;
  }
  if (typeof value.isNew === "boolean") repository.isNew = value.isNew;
  if (typeof value.isPinned === "boolean") {
    repository.isPinned = value.isPinned;
  }
  const etag = readOptionalString(value, "etag");
  if (etag !== undefined) repository.etag = etag;
  const latestRelease = parseCachedRelease(value.latestRelease);
  if (latestRelease) repository.latestRelease = latestRelease;

  if (value.tags !== undefined) {
    const importedTags = normalizeRepositoryTags(value.tags);
    if (importedTags.success) repository.tags = importedTags.tags;
  }

  const importedReleaseChannels = readEnumArray(
    value.releaseChannels,
    releaseChannels,
  );
  if (importedReleaseChannels) {
    repository.releaseChannels = importedReleaseChannels;
  }
  const importedPreReleaseChannels = readEnumArray(
    value.preReleaseSubChannels,
    preReleaseChannels,
  );
  const hasValidCustomPreReleaseMarkers =
    Array.isArray(value.customPreReleaseMarkers) &&
    value.customPreReleaseMarkers.every(
      (marker): marker is string => typeof marker === "string",
    ) &&
    getInvalidCustomPreReleaseMarkers(value.customPreReleaseMarkers).length ===
      0;
  const importedCustomPreReleaseMarkers = hasValidCustomPreReleaseMarkers
    ? normalizeCustomPreReleaseMarkers(
        value.customPreReleaseMarkers as string[],
      )
    : undefined;
  const migratedPreReleaseConfiguration = migrateLegacyPreReleaseConfiguration(
    importedPreReleaseChannels,
    importedCustomPreReleaseMarkers,
  );
  if (importedPreReleaseChannels !== undefined) {
    repository.preReleaseSubChannels =
      migratedPreReleaseConfiguration.preReleaseSubChannels;
  }
  if (
    hasValidCustomPreReleaseMarkers ||
    migratedPreReleaseConfiguration.customPreReleaseMarkers !== undefined
  ) {
    repository.customPreReleaseMarkers =
      migratedPreReleaseConfiguration.customPreReleaseMarkers;
  }
  if (
    releaseSelectionStrategies.has(
      value.releaseSelectionStrategy as ReleaseSelectionStrategy,
    )
  ) {
    repository.releaseSelectionStrategy =
      value.releaseSelectionStrategy as ReleaseSelectionStrategy;
  }
  const versionTagPattern = readOptionalString(
    value,
    "versionTagPattern",
  )?.trim();
  if (versionTagPattern && !validateVersionTagPattern(versionTagPattern)) {
    repository.versionTagPattern = versionTagPattern;
  }

  const releasesPerPage = readOptionalNullableFiniteNumber(
    value,
    "releasesPerPage",
  );
  if (releasesPerPage !== undefined) {
    repository.releasesPerPage = releasesPerPage;
  }
  const refreshInterval = readOptionalNullableFiniteNumber(
    value,
    "refreshInterval",
  );
  if (refreshInterval !== undefined) {
    repository.refreshInterval = refreshInterval;
  }
  const cacheInterval = readOptionalNullableFiniteNumber(
    value,
    "cacheInterval",
  );
  if (cacheInterval !== undefined) repository.cacheInterval = cacheInterval;

  const backgroundCheckCron = readOptionalNullableString(
    value,
    "backgroundCheckCron",
  );
  if (backgroundCheckCron !== undefined) {
    repository.backgroundCheckCron = backgroundCheckCron;
  }
  for (const key of ["lastBackgroundCheckAt", "appriseTags"] as const) {
    const field = readOptionalString(value, key);
    if (field !== undefined) repository[key] = field;
  }
  // Trimmed as the save stores them, so a filter of spaces clears a stored one.
  for (const key of ["includeRegex", "excludeRegex"] as const) {
    const field = readOptionalString(value, key);
    if (field !== undefined) repository[key] = normalizePatternInput(field);
  }
  if (appriseFormats.has(value.appriseFormat as AppriseFormat)) {
    repository.appriseFormat = value.appriseFormat as AppriseFormat;
  }

  return repository;
}

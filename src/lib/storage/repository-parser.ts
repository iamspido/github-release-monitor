import { normalizeLocale } from "@/i18n/config";
import { logger } from "@/lib/logger";
import {
  getInvalidCustomPreReleaseMarkers,
  legacyPreReleaseMarkers,
  migrateLegacyPreReleaseConfiguration,
} from "@/lib/releases/pre-release-markers";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import {
  assertJsonObject,
  assertOptionalField,
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isNonEmptyString,
  isNullable,
  isOneOf,
  isString,
} from "@/lib/storage/runtime-validation";
import type {
  CachedRelease,
  CommitLink,
  CommitLinksRetry,
  GithubRelease,
  PendingReleaseNotification,
  Repository,
} from "@/types";
import { allPreReleaseTypes, releaseSelectionStrategies } from "@/types";

const isReleaseChannel = isOneOf(["stable", "prerelease", "draft"]);
const isPreReleaseChannel = isOneOf([
  ...allPreReleaseTypes,
  ...legacyPreReleaseMarkers,
]);
const isAppriseFormat = isOneOf(["text", "markdown", "html"]);
const isReleaseSource = isOneOf(["release", "tag"]);
const isReleaseSelectionStrategy = isOneOf(releaseSelectionStrategies);
const isNotificationChannel = isOneOf(["email", "apprise"]);
const isTimeFormat = isOneOf(["12h", "24h"]);
const repositoryLog = logger.withScope("Repositories");
const isSafeCommitUrl = (value: string, sha: string): boolean => {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (path.endsWith(`/commit/${sha}`) || path.endsWith(`/-/commit/${sha}`))
    );
  } catch {
    return false;
  }
};
const isCommitLink = (value: unknown): value is CommitLink => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.ref === "string" &&
    /^[0-9a-f]{7,40}$/i.test(link.ref) &&
    typeof link.sha === "string" &&
    /^[0-9a-f]{40}$/i.test(link.sha) &&
    link.sha.toLowerCase().startsWith(link.ref.toLowerCase()) &&
    typeof link.url === "string" &&
    isSafeCommitUrl(link.url, link.sha.toLowerCase())
  );
};
const isCommitLinksRetry = (value: unknown): value is CommitLinksRetry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const retry = value as Record<string, unknown>;
  return (
    typeof retry.attempts === "number" &&
    Number.isInteger(retry.attempts) &&
    retry.attempts >= 0 &&
    typeof retry.retry_at === "string" &&
    Number.isFinite(Date.parse(retry.retry_at)) &&
    (retry.checked_refs === undefined ||
      (Array.isArray(retry.checked_refs) &&
        retry.checked_refs.every(
          (ref): ref is string =>
            typeof ref === "string" && /^[0-9a-f]{7,40}$/i.test(ref),
        ) &&
        new Set(retry.checked_refs.map((ref) => ref.toLowerCase())).size ===
          retry.checked_refs.length))
  );
};

function sanitizeCommitLinkMetadata(
  release: Record<string, unknown>,
  path: string,
): void {
  const commitLinksValid =
    release.commit_links === undefined ||
    isArrayOf(isCommitLink)(release.commit_links);
  const resolvedAtValid =
    release.commit_links_resolved_at === undefined ||
    (typeof release.commit_links_resolved_at === "string" &&
      Number.isFinite(Date.parse(release.commit_links_resolved_at)));
  const retryValid =
    release.commit_links_retry === undefined ||
    isCommitLinksRetry(release.commit_links_retry);
  const stateValid =
    !(
      release.commit_links_resolved_at !== undefined &&
      release.commit_links_retry !== undefined
    ) &&
    !(
      release.commit_links_resolved_at !== undefined &&
      release.commit_links === undefined
    );

  if (commitLinksValid && resolvedAtValid && retryValid && stateValid) return;

  delete release.commit_links;
  delete release.commit_links_resolved_at;
  delete release.commit_links_retry;
  repositoryLog.warn(
    `Discarding invalid derived commit-link metadata at ${path}; it will be rebuilt during a future release check.`,
  );
}

function parseCachedRelease(value: unknown, path: string): CachedRelease {
  const release = assertJsonObject(value, path);
  for (const key of ["html_url", "tag_name", "created_at"] as const) {
    if (!isString(release[key])) {
      throw new Error(`${path}.${key} must be a string.`);
    }
  }
  assertOptionalField(
    release,
    "name",
    isNullable(isString),
    "a string or null",
  );
  assertOptionalField(
    release,
    "body",
    isNullable(isString),
    "a string or null",
  );
  sanitizeCommitLinkMetadata(release, path);
  assertOptionalField(
    release,
    "commit_links",
    isArrayOf(isCommitLink),
    "an array of commit links",
  );
  assertOptionalField(
    release,
    "commit_links_resolved_at",
    (value): value is string =>
      typeof value === "string" && Number.isFinite(Date.parse(value)),
    "a valid commit-link resolution timestamp",
  );
  assertOptionalField(
    release,
    "commit_links_retry",
    isCommitLinksRetry,
    "a commit-link retry state",
  );
  if (
    release.commit_links_resolved_at !== undefined &&
    release.commit_links_retry !== undefined
  ) {
    throw new Error(
      `${path} cannot contain both commit_links_resolved_at and commit_links_retry.`,
    );
  }
  if (
    release.commit_links_resolved_at !== undefined &&
    release.commit_links === undefined
  ) {
    throw new Error(`${path}.commit_links_resolved_at requires commit_links.`);
  }
  assertOptionalField(
    release,
    "published_at",
    isNullable(isString),
    "a string or null",
  );
  assertOptionalField(release, "published_at_unknown", isBoolean, "a boolean");
  assertOptionalField(release, "fetched_at", isString, "a string");
  assertOptionalField(release, "source", isReleaseSource, "release or tag");
  return release as CachedRelease;
}

function parsePendingRelease(value: unknown, path: string): GithubRelease {
  const release = assertJsonObject(value, path);
  if (!isFiniteNumber(release.id)) {
    throw new Error(`${path}.id must be a finite number.`);
  }
  for (const key of ["html_url", "tag_name", "created_at"] as const) {
    if (!isString(release[key])) {
      throw new Error(`${path}.${key} must be a string.`);
    }
  }
  for (const key of ["name", "body", "published_at"] as const) {
    if (!isNullable(isString)(release[key])) {
      throw new Error(`${path}.${key} must be a string or null.`);
    }
  }
  sanitizeCommitLinkMetadata(release, path);
  assertOptionalField(
    release,
    "commit_links",
    isArrayOf(isCommitLink),
    "an array of commit links",
  );
  assertOptionalField(
    release,
    "commit_links_resolved_at",
    (value): value is string =>
      typeof value === "string" && Number.isFinite(Date.parse(value)),
    "a valid commit-link resolution timestamp",
  );
  assertOptionalField(
    release,
    "commit_links_retry",
    isCommitLinksRetry,
    "a commit-link retry state",
  );
  if (
    release.commit_links_resolved_at !== undefined &&
    release.commit_links_retry !== undefined
  ) {
    throw new Error(
      `${path} cannot contain both commit_links_resolved_at and commit_links_retry.`,
    );
  }
  if (
    release.commit_links_resolved_at !== undefined &&
    release.commit_links === undefined
  ) {
    throw new Error(`${path}.commit_links_resolved_at requires commit_links.`);
  }
  for (const key of ["prerelease", "draft"] as const) {
    if (!isBoolean(release[key])) {
      throw new Error(`${path}.${key} must be a boolean.`);
    }
  }
  assertOptionalField(release, "published_at_unknown", isBoolean, "a boolean");
  assertOptionalField(release, "fetched_at", isString, "a string");
  return release as GithubRelease;
}

function parsePendingNotification(
  value: unknown,
  path: string,
): PendingReleaseNotification {
  const notification = assertJsonObject(value, path);
  for (const key of ["id", "locale", "createdAt"] as const) {
    if (!isNonEmptyString(notification[key])) {
      throw new Error(`${path}.${key} must be a non-empty string.`);
    }
  }
  notification.locale = normalizeLocale(notification.locale);
  if (
    !isFiniteNumber(notification.attempts) ||
    !Number.isInteger(notification.attempts) ||
    notification.attempts < 0
  ) {
    throw new Error(`${path}.attempts must be a non-negative integer.`);
  }
  assertOptionalField(notification, "nextAttemptAt", isString, "a string");
  assertOptionalField(notification, "abandonedAt", isString, "a string");
  assertOptionalField(notification, "batchId", isString, "a string");
  if (
    !Array.isArray(notification.channels) ||
    notification.channels.length === 0 ||
    !notification.channels.every(isNotificationChannel)
  ) {
    throw new Error(`${path}.channels must contain notification channels.`);
  }
  if (notification.channelStates !== undefined) {
    const channelStates = assertJsonObject(
      notification.channelStates,
      `${path}.channelStates`,
    );
    for (const channel of ["email", "apprise"] as const) {
      if (channelStates[channel] === undefined) continue;
      const state = assertJsonObject(
        channelStates[channel],
        `${path}.channelStates.${channel}`,
      );
      if (
        !isFiniteNumber(state.attempts) ||
        !Number.isInteger(state.attempts) ||
        state.attempts < 0
      ) {
        throw new Error(
          `${path}.channelStates.${channel}.attempts must be a non-negative integer.`,
        );
      }
      assertOptionalField(state, "nextAttemptAt", isString, "a string");
      assertOptionalField(state, "abandonedAt", isString, "a string");
    }
  }

  const repository = assertJsonObject(
    notification.repository,
    `${path}.repository`,
  );
  for (const key of ["id", "url"] as const) {
    if (!isNonEmptyString(repository[key])) {
      throw new Error(`${path}.repository.${key} must be a non-empty string.`);
    }
  }
  assertOptionalField(repository, "appriseTags", isString, "a string");
  assertOptionalField(
    repository,
    "appriseFormat",
    isAppriseFormat,
    "text, markdown, or html",
  );

  parsePendingRelease(notification.release, `${path}.release`);
  const settings = assertJsonObject(notification.settings, `${path}.settings`);
  if (!isTimeFormat(settings.timeFormat)) {
    throw new Error(`${path}.settings.timeFormat must be 12h or 24h.`);
  }
  assertOptionalField(
    settings,
    "appriseMaxCharacters",
    isFiniteNumber,
    "a finite number",
  );
  assertOptionalField(settings, "appriseTags", isString, "a string");
  assertOptionalField(
    settings,
    "appriseFormat",
    isAppriseFormat,
    "text, markdown, or html",
  );
  for (const key of [
    "emailNotificationMode",
    "appriseNotificationMode",
  ] as const) {
    assertOptionalField(
      settings,
      key,
      isOneOf(["per_release", "batch"]),
      "per_release or batch",
    );
  }
  return notification as PendingReleaseNotification;
}

export function parseRepository(value: unknown, index: number): Repository {
  const path = `Repository data[${index}]`;
  const repository = assertJsonObject(value, path);
  if (!isNonEmptyString(repository.id)) {
    throw new Error(`${path}.id must be a non-empty string.`);
  }
  if (!isNonEmptyString(repository.url)) {
    throw new Error(`${path}.url must be a non-empty string.`);
  }

  const normalizedDisplayName = normalizeRepositoryDisplayName(
    repository.displayName,
  );
  if (!normalizedDisplayName.success) {
    throw new Error(`${path}.displayName must be a valid display name.`);
  }
  repository.displayName = normalizedDisplayName.displayName;

  assertOptionalField(repository, "lastSeenReleaseTag", isString, "a string");
  assertOptionalField(repository, "isNew", isBoolean, "a boolean");
  assertOptionalField(repository, "isPinned", isBoolean, "a boolean");
  assertOptionalField(repository, "etag", isString, "a string");
  if (repository.latestRelease !== undefined) {
    parseCachedRelease(repository.latestRelease, `${path}.latestRelease`);
  }
  if (repository.tags !== undefined) {
    const normalizedTags = normalizeRepositoryTags(repository.tags);
    if (!normalizedTags.success) {
      throw new Error(`${path}.tags contains invalid repository tags.`);
    }
    repository.tags = normalizedTags.tags;
  }
  assertOptionalField(
    repository,
    "releaseChannels",
    isArrayOf(isReleaseChannel),
    "an array of release channels",
  );
  assertOptionalField(
    repository,
    "preReleaseSubChannels",
    isArrayOf(isPreReleaseChannel),
    "an array of prerelease channels",
  );
  assertOptionalField(
    repository,
    "customPreReleaseMarkers",
    isArrayOf(isString),
    "an array of custom prerelease markers",
  );
  const invalidCustomPreReleaseMarkers = getInvalidCustomPreReleaseMarkers(
    repository.customPreReleaseMarkers as string[] | undefined,
  );
  if (invalidCustomPreReleaseMarkers.length > 0) {
    throw new Error(
      `${path}.customPreReleaseMarkers contains invalid markers: ${invalidCustomPreReleaseMarkers.join(", ")}.`,
    );
  }
  const migratedPreReleaseConfiguration = migrateLegacyPreReleaseConfiguration(
    repository.preReleaseSubChannels as string[] | undefined,
    repository.customPreReleaseMarkers as string[] | undefined,
  );
  repository.preReleaseSubChannels =
    migratedPreReleaseConfiguration.preReleaseSubChannels;
  repository.customPreReleaseMarkers =
    migratedPreReleaseConfiguration.customPreReleaseMarkers;
  assertOptionalField(
    repository,
    "releaseSelectionStrategy",
    isReleaseSelectionStrategy,
    "a supported release selection strategy",
  );
  for (const key of [
    "releasesPerPage",
    "refreshInterval",
    "cacheInterval",
  ] as const) {
    assertOptionalField(
      repository,
      key,
      isNullable(isFiniteNumber),
      "a finite number or null",
    );
  }
  assertOptionalField(
    repository,
    "backgroundCheckCron",
    isNullable(isString),
    "a string or null",
  );
  for (const key of [
    "lastBackgroundCheckAt",
    "includeRegex",
    "excludeRegex",
    "versionTagPattern",
    "appriseTags",
  ] as const) {
    assertOptionalField(repository, key, isString, "a string");
  }
  assertOptionalField(
    repository,
    "appriseFormat",
    isAppriseFormat,
    "text, markdown, or html",
  );
  if (repository.pendingNotifications !== undefined) {
    if (!Array.isArray(repository.pendingNotifications)) {
      throw new Error(`${path}.pendingNotifications must be an array.`);
    }
    repository.pendingNotifications.forEach((notification, index) => {
      parsePendingNotification(
        notification,
        `${path}.pendingNotifications[${index}]`,
      );
    });
  }
  return repository as Repository;
}

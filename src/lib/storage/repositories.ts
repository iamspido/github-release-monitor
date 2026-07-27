import path from "node:path";
import { normalizeLocale } from "@/i18n/config";
import { logger } from "@/lib/logger";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { JsonFileStore } from "@/lib/storage/json-file-store";
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
  GithubRelease,
  PendingReleaseNotification,
  Repository,
} from "@/types";
import { allPreReleaseTypes, releaseSelectionStrategies } from "@/types";

// Resolve the path to the data file.
// Using process.cwd() ensures the path is correct whether running in dev or prod.
const dataFilePath = path.join(process.cwd(), "data", "repositories.json");
const isPrefixedRepoId = (repoId: string) =>
  /^[^/]+:(?:[^/]+\/)+[^/]+$/i.test(repoId);

let migrationInFlight: Promise<void> | null = null;

const isReleaseChannel = isOneOf(["stable", "prerelease", "draft"]);
const isPreReleaseChannel = isOneOf(allPreReleaseTypes);
const isAppriseFormat = isOneOf(["text", "markdown", "html"]);
const isReleaseSource = isOneOf(["release", "tag"]);
const isReleaseSelectionStrategy = isOneOf(releaseSelectionStrategies);
const isNotificationChannel = isOneOf(["email", "apprise"]);
const isTimeFormat = isOneOf(["12h", "24h"]);

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
  if (!isFiniteNumber(notification.attempts) || notification.attempts < 0) {
    throw new Error(`${path}.attempts must be a non-negative number.`);
  }
  assertOptionalField(notification, "nextAttemptAt", isString, "a string");
  assertOptionalField(notification, "abandonedAt", isString, "a string");
  if (
    !Array.isArray(notification.channels) ||
    notification.channels.length === 0 ||
    !notification.channels.every(isNotificationChannel)
  ) {
    throw new Error(`${path}.channels must contain notification channels.`);
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
  return notification as PendingReleaseNotification;
}

function parseRepository(value: unknown, index: number): Repository {
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

function preferDefined<T>(base: T, incoming: T): T;
function preferDefined<T>(
  base: T | undefined,
  incoming: T | undefined,
): T | undefined;
function preferDefined<T>(
  base: T | undefined,
  incoming: T | undefined,
): T | undefined {
  return base === undefined ? incoming : base;
}

const repositoryStore = new JsonFileStore<Repository[]>({
  filePath: dataFilePath,
  defaultValue: [],
  scope: "Repositories",
  parse: (value) => {
    if (!Array.isArray(value)) {
      throw new Error("Repository data must be an array.");
    }
    return value.map(parseRepository);
  },
  writeErrorMessage: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    return `Failed to write to repository file. Please check file permissions. Server Error: ${
      code || message
    }`;
  },
});

function mergeRepositoriesPreferFirst(
  base: Repository,
  incoming: Repository,
): Repository {
  return {
    id: base.id,
    url: preferDefined(base.url, incoming.url),
    displayName: preferDefined(base.displayName, incoming.displayName),
    lastSeenReleaseTag: preferDefined(
      base.lastSeenReleaseTag,
      incoming.lastSeenReleaseTag,
    ),
    isNew: preferDefined(base.isNew, incoming.isNew),
    etag: preferDefined(base.etag, incoming.etag),
    latestRelease: preferDefined(base.latestRelease, incoming.latestRelease),
    isPinned: preferDefined(base.isPinned, incoming.isPinned),
    tags: preferDefined(base.tags, incoming.tags),
    releaseChannels: preferDefined(
      base.releaseChannels,
      incoming.releaseChannels,
    ),
    preReleaseSubChannels: preferDefined(
      base.preReleaseSubChannels,
      incoming.preReleaseSubChannels,
    ),
    releaseSelectionStrategy: preferDefined(
      base.releaseSelectionStrategy,
      incoming.releaseSelectionStrategy,
    ),
    versionTagPattern: preferDefined(
      base.versionTagPattern,
      incoming.versionTagPattern,
    ),
    releasesPerPage: preferDefined(
      base.releasesPerPage,
      incoming.releasesPerPage,
    ),
    refreshInterval: preferDefined(
      base.refreshInterval,
      incoming.refreshInterval,
    ),
    cacheInterval: preferDefined(base.cacheInterval, incoming.cacheInterval),
    backgroundCheckCron: preferDefined(
      base.backgroundCheckCron,
      incoming.backgroundCheckCron,
    ),
    lastBackgroundCheckAt: preferDefined(
      base.lastBackgroundCheckAt,
      incoming.lastBackgroundCheckAt,
    ),
    includeRegex: preferDefined(base.includeRegex, incoming.includeRegex),
    excludeRegex: preferDefined(base.excludeRegex, incoming.excludeRegex),
    appriseTags: preferDefined(base.appriseTags, incoming.appriseTags),
    appriseFormat: preferDefined(base.appriseFormat, incoming.appriseFormat),
    pendingNotifications: preferDefined(
      base.pendingNotifications,
      incoming.pendingNotifications,
    ),
  };
}

function migrateRepositoriesIds(repositories: Repository[]): {
  migrated: Repository[];
  changed: boolean;
} {
  let changed = false;
  const byId = new Map<string, Repository>();
  const order: string[] = [];

  for (const repo of repositories) {
    const rawId = typeof repo.id === "string" ? repo.id.trim() : "";
    const nextId = isPrefixedRepoId(rawId)
      ? rawId.toLowerCase()
      : `github:${rawId}`.toLowerCase();

    if (nextId !== rawId) changed = true;

    const nextRepo: Repository =
      nextId === rawId ? repo : { ...repo, id: nextId };
    const existing = byId.get(nextId);

    if (!existing) {
      byId.set(nextId, nextRepo);
      order.push(nextId);
      continue;
    }

    changed = true;
    byId.set(nextId, mergeRepositoriesPreferFirst(existing, nextRepo));
  }

  const migrated: Repository[] = [];
  for (const id of order) {
    const repo = byId.get(id);
    if (repo) migrated.push(repo);
  }
  return { migrated, changed };
}

export async function getRepositories(): Promise<Repository[]> {
  const data = await repositoryStore.read();

  const hasLegacyIds = data.some(
    (r) => typeof r?.id === "string" && !isPrefixedRepoId(r.id.trim()),
  );

  if (hasLegacyIds) {
    if (!migrationInFlight) {
      const { migrated, changed } = migrateRepositoriesIds(data);

      if (changed) {
        logger
          .withScope("Repositories")
          .info("Migrating repository ids to provider-prefixed format.");
      }

      migrationInFlight = (async () => {
        if (changed) {
          await saveRepositories(migrated);
        }
      })().finally(() => {
        migrationInFlight = null;
      });

      await migrationInFlight;
      return migrated;
    }

    await migrationInFlight;
    return repositoryStore.read();
  }

  return data;
}

export async function saveRepositories(
  repositories: Repository[],
): Promise<void> {
  await repositoryStore.write(repositories);
}

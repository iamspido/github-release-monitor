import path from "node:path";
import { logger } from "@/lib/logger";
import { JsonFileStore } from "@/lib/storage/json-file-store";
import type { Repository } from "@/types";

// Resolve the path to the data file.
// Using process.cwd() ensures the path is correct whether running in dev or prod.
const dataFilePath = path.join(process.cwd(), "data", "repositories.json");
const isPrefixedRepoId = (repoId: string) =>
  /^[^/]+:(?:[^/]+\/)+[^/]+$/i.test(repoId);

let migrationInFlight: Promise<void> | null = null;

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
    return value as Repository[];
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
    lastSeenReleaseTag: preferDefined(
      base.lastSeenReleaseTag,
      incoming.lastSeenReleaseTag,
    ),
    isNew: preferDefined(base.isNew, incoming.isNew),
    etag: preferDefined(base.etag, incoming.etag),
    latestRelease: preferDefined(base.latestRelease, incoming.latestRelease),
    releaseChannels: preferDefined(
      base.releaseChannels,
      incoming.releaseChannels,
    ),
    preReleaseSubChannels: preferDefined(
      base.preReleaseSubChannels,
      incoming.preReleaseSubChannels,
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

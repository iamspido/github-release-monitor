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

const repositoryStore = new JsonFileStore<Repository[]>({
  filePath: dataFilePath,
  defaultValue: [],
  scope: "Repositories",
  parse: (value) => (Array.isArray(value) ? (value as Repository[]) : []),
  readFallback: () => [],
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
  const merged: Repository = { ...base };

  for (const [key, value] of Object.entries(incoming) as Array<
    [keyof Repository, Repository[keyof Repository]]
  >) {
    if (key === "id") continue;
    if (merged[key] === undefined && value !== undefined) {
      // @ts-expect-error dynamic assignment is safe for Repository keys
      merged[key] = value;
    }
  }

  return merged;
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
  await repositoryStore.ensureExists();
  try {
    const data = await repositoryStore.read();

    const hasLegacyIds = Array.isArray(data)
      ? data.some(
          (r) => typeof r?.id === "string" && !isPrefixedRepoId(r.id.trim()),
        )
      : false;

    if (hasLegacyIds) {
      if (!migrationInFlight) {
        const { migrated, changed } = migrateRepositoriesIds(
          Array.isArray(data) ? data : [],
        );

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
  } catch (error) {
    logger
      .withScope("Repositories")
      .error("Error reading or parsing repositories.json:", error);
    // Return an empty array or throw an error, depending on desired behavior for a corrupted file.
    return [];
  }
}

export async function saveRepositories(
  repositories: Repository[],
): Promise<void> {
  await repositoryStore.write(repositories);
}

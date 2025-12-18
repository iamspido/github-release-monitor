"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import type { Repository } from "@/types";

// Resolve the path to the data file.
// Using process.cwd() ensures the path is correct whether running in dev or prod.
const dataFilePath = path.join(process.cwd(), "data", "repositories.json");
const dataDirPath = path.dirname(dataFilePath);
const isPrefixedRepoId = (repoId: string) =>
  /^[^/]+:[^/]+\/[^/]+$/i.test(repoId);

let migrationInFlight: Promise<void> | null = null;

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

async function ensureDataFileExists() {
  try {
    // Ensure the directory exists first.
    await fs.mkdir(dataDirPath, { recursive: true });
    // Then check for the file.
    await fs.access(dataFilePath);
  } catch {
    // File doesn't exist, create it with an empty array.
    await fs.writeFile(dataFilePath, JSON.stringify([], null, 2), "utf8");
    logger
      .withScope("Repositories")
      .info(`Created repository data file at: ${dataFilePath}`);
  }
}

export async function getRepositories(): Promise<Repository[]> {
  await ensureDataFileExists();
  try {
    const fileContent = await fs.readFile(dataFilePath, "utf8");
    const data = JSON.parse(fileContent) as Repository[];

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
      const migratedContent = await fs.readFile(dataFilePath, "utf8");
      return JSON.parse(migratedContent) as Repository[];
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
  await ensureDataFileExists();
  try {
    const fileContent = JSON.stringify(repositories, null, 2);
    await fs.writeFile(dataFilePath, fileContent, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    logger
      .withScope("Repositories")
      .error("Error writing to repositories.json:", error);
    // Throw a more specific error that can be caught by the server action
    throw new Error(
      `Failed to write to repository file. Please check file permissions. Server Error: ${
        code || message
      }`,
    );
  }
}

import { CronExpressionParser } from "cron-parser";
import type { AppSettings, Repository } from "@/types";

const MIN_REFRESH_INTERVAL_MINUTES = 1;
const MAX_REFRESH_INTERVAL_MINUTES = 5_256_000;
const CRON_DUE_WINDOW_MS = 2 * 60 * 1000;

function toFiniteInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

export function normalizeRefreshInterval(value: unknown): number | undefined {
  const integer = toFiniteInteger(value);
  if (integer === null) return undefined;
  return Math.min(
    Math.max(integer, MIN_REFRESH_INTERVAL_MINUTES),
    MAX_REFRESH_INTERVAL_MINUTES,
  );
}

export function normalizeCacheInterval(value: unknown): number | undefined {
  const integer = toFiniteInteger(value);
  if (integer === null) return undefined;
  return Math.max(integer, 0);
}

export function getEffectiveRefreshIntervalMinutes(
  repository: Pick<Repository, "refreshInterval">,
  settings: Pick<AppSettings, "refreshInterval">,
): number {
  return (
    normalizeRefreshInterval(repository.refreshInterval) ??
    normalizeRefreshInterval(settings.refreshInterval) ??
    MIN_REFRESH_INTERVAL_MINUTES
  );
}

export function getEffectiveBackgroundCheckCron(
  repository: Pick<Repository, "refreshInterval" | "backgroundCheckCron">,
  settings: Pick<AppSettings, "backgroundCheckCron">,
): string | undefined {
  const repositoryCron = normalizeBackgroundCheckCron(
    repository.backgroundCheckCron,
  );
  if (repositoryCron) return repositoryCron;

  if (typeof repository.refreshInterval === "number") return undefined;

  return normalizeBackgroundCheckCron(settings.backgroundCheckCron);
}

export function getEffectiveCacheIntervalMinutes(
  repository: Pick<Repository, "cacheInterval">,
  settings: Pick<AppSettings, "cacheInterval">,
): number {
  return (
    normalizeCacheInterval(repository.cacheInterval) ??
    normalizeCacheInterval(settings.cacheInterval) ??
    0
  );
}

export function normalizeBackgroundCheckCron(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const cron = value.trim().replace(/\s+/g, " ");
  if (!cron) return undefined;
  return isValidBackgroundCheckCron(cron) ? cron : undefined;
}

export function isValidBackgroundCheckCron(value: string): boolean {
  const cron = value.trim().replace(/\s+/g, " ");
  if (cron.split(" ").length !== 5) return false;

  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPreviousCronRun(cron: string, now: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now })
      .prev()
      .toDate();
  } catch {
    return null;
  }
}

export function isRepositoryDueForBackgroundCheck(
  repository: Pick<
    Repository,
    "refreshInterval" | "backgroundCheckCron" | "lastBackgroundCheckAt"
  >,
  settings: Pick<AppSettings, "refreshInterval" | "backgroundCheckCron">,
  now = new Date(),
): boolean {
  const cron = getEffectiveBackgroundCheckCron(repository, settings);
  const lastCheckedAt = parseDate(repository.lastBackgroundCheckAt);

  if (cron) {
    const previousRun = getPreviousCronRun(cron, now);
    if (!previousRun) return false;

    const ageMs = now.getTime() - previousRun.getTime();
    if (ageMs < 0 || ageMs > CRON_DUE_WINDOW_MS) return false;

    return !lastCheckedAt || lastCheckedAt.getTime() < previousRun.getTime();
  }

  if (!lastCheckedAt) return true;

  const intervalMs =
    getEffectiveRefreshIntervalMinutes(repository, settings) * 60 * 1000;
  return now.getTime() - lastCheckedAt.getTime() >= intervalMs;
}

export function filterRepositoriesDueForBackgroundCheck(
  repositories: Repository[],
  settings: AppSettings,
  now = new Date(),
): Repository[] {
  return repositories.filter((repository) =>
    isRepositoryDueForBackgroundCheck(repository, settings, now),
  );
}

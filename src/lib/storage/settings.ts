import type { Stats } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultLocale, locales } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import {
  normalizeProviderSortOrder,
  normalizeReleaseSortOrder,
} from "@/lib/release-sort";
import {
  defaultSecurityHighlightColorPreset,
  defaultSecurityHighlightCustomColor,
} from "@/lib/security-release";
import type { AppSettings, Locale } from "@/types";
import { allPreReleaseTypes, defaultProviderSortOrder } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "settings.json");
const dataDirPath = path.dirname(dataFilePath);

const hasGithubToken = Boolean(process.env.GITHUB_ACCESS_TOKEN?.trim());
const defaultParallelRepoFetches = hasGithubToken ? 5 : 1;

const defaultSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10, // in minutes
  cacheInterval: 5, // in minutes
  backgroundCheckCron: undefined,
  releasesPerPage: 30, // GitHub API default
  parallelRepoFetches: defaultParallelRepoFetches,
  releaseChannels: ["stable"],
  preReleaseSubChannels: allPreReleaseTypes,
  releaseSortOrder: "latest_first",
  providerSortOrder: defaultProviderSortOrder,
  prioritizeNewSecurityReleases: false,
  securityHighlightColorPreset: defaultSecurityHighlightColorPreset,
  securityHighlightCustomColor: defaultSecurityHighlightCustomColor,
  confirmSecurityAcknowledge: false,
  includeDefaultSecurityPatterns: true,
  customSecurityPatterns: undefined,
  showAcknowledge: true,
  showMarkAsNew: true,
  showProviderPrefixInRepoId: true,
  showProviderDomainInRepoId: true,
  repositoryFormExpanded: true,
  includeRegex: undefined,
  excludeRegex: undefined,
  appriseMaxCharacters: 1800,
  appriseTags: undefined,
  appriseFormat: "text",
};

const CACHE_CHECK_INTERVAL_MS = 500;

let cachedSettings: AppSettings | null = null;
let cachedMtimeMs: number | null = null;
let lastMtimeCheck = 0;
async function ensureDataFileExists() {
  try {
    await fs.mkdir(dataDirPath, { recursive: true });
    await fs.access(dataFilePath);
  } catch {
    await fs.writeFile(
      dataFilePath,
      JSON.stringify(defaultSettings, null, 2),
      "utf8",
    );
    logger
      .withScope("Settings")
      .info(`Created settings data file at: ${dataFilePath}`);
  }
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    releaseChannels: [...settings.releaseChannels],
    preReleaseSubChannels: settings.preReleaseSubChannels
      ? [...(settings.preReleaseSubChannels ?? [])]
      : undefined,
    releaseSortOrder: normalizeReleaseSortOrder(settings.releaseSortOrder),
    providerSortOrder: normalizeProviderSortOrder(settings.providerSortOrder),
  };
}

async function refreshCache(existingStat?: Stats) {
  try {
    const [fileContent, stat] = await Promise.all([
      fs.readFile(dataFilePath, "utf8"),
      existingStat ? Promise.resolve(existingStat) : fs.stat(dataFilePath),
    ]);
    const data = JSON.parse(fileContent);
    const merged = { ...defaultSettings, ...(data as Partial<AppSettings>) };
    merged.releaseSortOrder = normalizeReleaseSortOrder(
      merged.releaseSortOrder,
    );
    merged.providerSortOrder = normalizeProviderSortOrder(
      merged.providerSortOrder,
    );
    cachedSettings = cloneSettings(merged);
    cachedMtimeMs = stat.mtimeMs;
    lastMtimeCheck = Date.now();
  } catch (error) {
    logger
      .withScope("Settings")
      .error("Error reading or parsing settings.json:", error);
    cachedSettings = cloneSettings(defaultSettings);
    cachedMtimeMs = null;
    lastMtimeCheck = Date.now();
  }
}

async function ensureCache() {
  await ensureDataFileExists();

  if (!cachedSettings) {
    await refreshCache();
    return;
  }

  const now = Date.now();
  if (now - lastMtimeCheck < CACHE_CHECK_INTERVAL_MS) {
    return;
  }

  try {
    const stat = await fs.stat(dataFilePath);
    lastMtimeCheck = now;
    if (cachedMtimeMs === null || stat.mtimeMs !== cachedMtimeMs) {
      await refreshCache(stat);
    }
  } catch (error) {
    logger.withScope("Settings").error("Error accessing settings.json:", error);
    cachedSettings = cloneSettings(defaultSettings);
    cachedMtimeMs = null;
    lastMtimeCheck = now;
  }
}

export async function getSettings(): Promise<AppSettings> {
  await ensureCache();
  if (!cachedSettings) {
    throw new Error("Settings cache is not available");
  }
  return cloneSettings(cachedSettings);
}

export async function getLocaleSetting(): Promise<Locale> {
  await ensureCache();
  const locale = cachedSettings?.locale;
  return locale && (locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : defaultLocale;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureDataFileExists();
  try {
    const fileContent = JSON.stringify(settings, null, 2);
    await fs.writeFile(dataFilePath, fileContent, "utf8");
    const stat = await fs.stat(dataFilePath);
    const merged = {
      ...defaultSettings,
      ...(settings as Partial<AppSettings>),
    };
    cachedSettings = cloneSettings(merged);
    cachedMtimeMs = stat.mtimeMs;
    lastMtimeCheck = Date.now();
  } catch (error) {
    logger
      .withScope("Settings")
      .error("Error writing to settings.json:", error);
    throw new Error("Could not save settings data.");
  }
}

export async function __clearSettingsCacheForTests__(): Promise<void> {
  cachedSettings = null;
  cachedMtimeMs = null;
  lastMtimeCheck = 0;
}

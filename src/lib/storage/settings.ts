import type { Stats } from "node:fs";
import path from "node:path";
import { defaultLocale, locales } from "@/i18n/routing";
import {
  normalizeProviderSortOrder,
  normalizeReleaseSortOrder,
} from "@/lib/release-sort";
import {
  defaultSecurityHighlightColorPreset,
  defaultSecurityHighlightCustomColor,
} from "@/lib/security-release";
import { JsonFileStore } from "@/lib/storage/json-file-store";
import type { AppSettings, Locale } from "@/types";
import { allPreReleaseTypes, defaultProviderSortOrder } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "settings.json");

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

function normalizeSettings(value: unknown): AppSettings {
  const merged = {
    ...defaultSettings,
    ...(value as Partial<AppSettings>),
  };
  merged.releaseSortOrder = normalizeReleaseSortOrder(merged.releaseSortOrder);
  merged.providerSortOrder = normalizeProviderSortOrder(
    merged.providerSortOrder,
  );
  return cloneSettings(merged);
}

const settingsStore = new JsonFileStore<AppSettings>({
  filePath: dataFilePath,
  defaultValue: defaultSettings,
  scope: "Settings",
  parse: normalizeSettings,
  writeErrorMessage: "Could not save settings data.",
});

async function refreshCache(existingStat?: Stats) {
  const [settings, stat] = await Promise.all([
    settingsStore.read(),
    existingStat ? Promise.resolve(existingStat) : settingsStore.stat(),
  ]);
  cachedSettings = cloneSettings(settings);
  cachedMtimeMs = stat.mtimeMs;
  lastMtimeCheck = Date.now();
}

async function ensureCache() {
  await settingsStore.ensureExists();

  if (!cachedSettings) {
    await refreshCache();
    return;
  }

  const now = Date.now();
  if (now - lastMtimeCheck < CACHE_CHECK_INTERVAL_MS) {
    return;
  }

  try {
    const stat = await settingsStore.stat();
    lastMtimeCheck = now;
    if (cachedMtimeMs === null || stat.mtimeMs !== cachedMtimeMs) {
      await refreshCache(stat);
    }
  } catch (error) {
    cachedSettings = null;
    cachedMtimeMs = null;
    throw error;
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
  await settingsStore.write(settings);
  const stat = await settingsStore.stat();
  cachedSettings = normalizeSettings(settings);
  cachedMtimeMs = stat.mtimeMs;
  lastMtimeCheck = Date.now();
}

export async function __clearSettingsCacheForTests__(): Promise<void> {
  cachedSettings = null;
  cachedMtimeMs = null;
  lastMtimeCheck = 0;
}

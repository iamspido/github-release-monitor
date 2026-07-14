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
import {
  assertJsonObject,
  assertOptionalField,
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isOneOf,
  isString,
} from "@/lib/storage/runtime-validation";
import type { AppSettings, Locale } from "@/types";
import { allPreReleaseTypes, defaultProviderSortOrder } from "@/types";

const dataFilePath = path.join(process.cwd(), "data", "settings.json");

export function createDefaultSettings(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): AppSettings {
  return {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 5,
    backgroundCheckCron: undefined,
    releasesPerPage: 30,
    parallelRepoFetches: env.GITHUB_ACCESS_TOKEN?.trim() ? 5 : 1,
    releaseChannels: ["stable"],
    preReleaseSubChannels: [...allPreReleaseTypes],
    releaseSortOrder: "latest_first",
    providerSortOrder: [...defaultProviderSortOrder],
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
}

const defaultSettings = createDefaultSettings();

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
  const persisted = assertJsonObject(value, "Settings data");
  const isReleaseChannel = isOneOf(["stable", "prerelease", "draft"]);
  const isPreReleaseChannel = isOneOf(allPreReleaseTypes);
  const isAppriseFormat = isOneOf(["text", "markdown", "html"]);

  for (const key of [
    "refreshInterval",
    "cacheInterval",
    "releasesPerPage",
    "parallelRepoFetches",
    "appriseMaxCharacters",
  ] as const) {
    assertOptionalField(persisted, key, isFiniteNumber, "a finite number");
  }
  for (const key of [
    "prioritizeNewSecurityReleases",
    "confirmSecurityAcknowledge",
    "includeDefaultSecurityPatterns",
    "showAcknowledge",
    "showMarkAsNew",
    "showProviderPrefixInRepoId",
    "showProviderDomainInRepoId",
    "repositoryFormExpanded",
  ] as const) {
    assertOptionalField(persisted, key, isBoolean, "a boolean");
  }
  for (const key of [
    "locale",
    "backgroundCheckCron",
    "releaseSortOrder",
    "securityHighlightCustomColor",
    "customSecurityPatterns",
    "includeRegex",
    "excludeRegex",
    "appriseTags",
  ] as const) {
    assertOptionalField(persisted, key, isString, "a string");
  }
  assertOptionalField(
    persisted,
    "timeFormat",
    isOneOf(["12h", "24h"]),
    "12h or 24h",
  );
  assertOptionalField(
    persisted,
    "releaseChannels",
    isArrayOf(isReleaseChannel),
    "an array of release channels",
  );
  assertOptionalField(
    persisted,
    "preReleaseSubChannels",
    isArrayOf(isPreReleaseChannel),
    "an array of prerelease channels",
  );
  assertOptionalField(
    persisted,
    "providerSortOrder",
    isArrayOf(isString),
    "an array of provider names",
  );
  assertOptionalField(
    persisted,
    "securityHighlightColorPreset",
    isOneOf(["yellow", "red", "orange", "blue", "purple", "custom"]),
    "a supported color preset",
  );
  assertOptionalField(
    persisted,
    "appriseFormat",
    isAppriseFormat,
    "text, markdown, or html",
  );

  const merged = {
    ...defaultSettings,
    ...(persisted as Partial<AppSettings>),
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

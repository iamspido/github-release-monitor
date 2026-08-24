import type { Stats } from "node:fs";
import path from "node:path";
import { defaultLocale, parseLocale } from "@/i18n/config";
import {
  normalizeProviderSortOrder,
  normalizeReleaseSortOrder,
} from "@/lib/release-sort";
import {
  getInvalidCustomPreReleaseMarkers,
  legacyPreReleaseMarkers,
  migrateLegacyPreReleaseConfiguration,
  normalizeCustomPreReleaseMarkers,
} from "@/lib/releases/pre-release-markers";
import { normalizeReleaseSelectionStrategy } from "@/lib/releases/selection";
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
    locale: defaultLocale,
    refreshInterval: 10,
    cacheInterval: 5,
    backgroundCheckCron: undefined,
    releasesPerPage: 30,
    parallelRepoFetches: env.GITHUB_ACCESS_TOKEN?.trim() ? 5 : 1,
    releaseChannels: ["stable"],
    preReleaseSubChannels: [...allPreReleaseTypes],
    customPreReleaseMarkers: [],
    releaseSelectionStrategy: "newest",
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
    emailIncludeReleaseNotes: true,
    emailNotificationMode: "per_release",
    appriseIncludeReleaseNotes: true,
    appriseNotificationMode: "per_release",
    notificationMaxMessagesPerRun: 20,
    notificationDeliveryConcurrency: 4,
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
    customPreReleaseMarkers: normalizeCustomPreReleaseMarkers(
      settings.customPreReleaseMarkers,
    ),
    releaseSortOrder: normalizeReleaseSortOrder(settings.releaseSortOrder),
    releaseSelectionStrategy: normalizeReleaseSelectionStrategy(
      settings.releaseSelectionStrategy,
    ),
    providerSortOrder: normalizeProviderSortOrder(settings.providerSortOrder),
  };
}

const isIntegerInRange = (min: number, max: number) => (value: unknown) =>
  isFiniteNumber(value) &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

export function normalizeSettings(value: unknown): AppSettings {
  const persisted = assertJsonObject(value, "Settings data");
  const isReleaseChannel = isOneOf(["stable", "prerelease", "draft"]);
  const isPreReleaseChannel = isOneOf([
    ...allPreReleaseTypes,
    ...legacyPreReleaseMarkers,
  ]);
  const isAppriseFormat = isOneOf(["text", "markdown", "html"]);
  const isNotificationMode = isOneOf(["per_release", "batch"]);

  assertOptionalField(
    persisted,
    "refreshInterval",
    isIntegerInRange(1, 5_256_000),
    "an integer between 1 and 5256000",
  );
  assertOptionalField(
    persisted,
    "cacheInterval",
    isIntegerInRange(0, 5_256_000),
    "an integer between 0 and 5256000",
  );
  assertOptionalField(
    persisted,
    "releasesPerPage",
    isIntegerInRange(1, 1000),
    "an integer between 1 and 1000",
  );
  assertOptionalField(
    persisted,
    "parallelRepoFetches",
    isIntegerInRange(1, 50),
    "an integer between 1 and 50",
  );
  assertOptionalField(
    persisted,
    "appriseMaxCharacters",
    isIntegerInRange(0, Number.MAX_SAFE_INTEGER),
    "a non-negative integer",
  );
  assertOptionalField(
    persisted,
    "notificationMaxMessagesPerRun",
    isIntegerInRange(0, 10_000),
    "an integer between 0 and 10000",
  );
  assertOptionalField(
    persisted,
    "notificationDeliveryConcurrency",
    isIntegerInRange(1, 50),
    "an integer between 1 and 50",
  );
  for (const key of [
    "prioritizeNewSecurityReleases",
    "confirmSecurityAcknowledge",
    "includeDefaultSecurityPatterns",
    "showAcknowledge",
    "showMarkAsNew",
    "showProviderPrefixInRepoId",
    "showProviderDomainInRepoId",
    "repositoryFormExpanded",
    "emailIncludeReleaseNotes",
    "appriseIncludeReleaseNotes",
  ] as const) {
    assertOptionalField(persisted, key, isBoolean, "a boolean");
  }
  for (const key of [
    "backgroundCheckCron",
    "releaseSortOrder",
    "releaseSelectionStrategy",
    "securityHighlightCustomColor",
    "customSecurityPatterns",
    "includeRegex",
    "excludeRegex",
    "appriseTags",
  ] as const) {
    assertOptionalField(persisted, key, isString, "a string");
  }
  assertOptionalField(persisted, "locale", isString, "a string");
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
    "customPreReleaseMarkers",
    isArrayOf(isString),
    "an array of custom prerelease markers",
  );
  const invalidCustomPreReleaseMarkers = getInvalidCustomPreReleaseMarkers(
    persisted.customPreReleaseMarkers as string[] | undefined,
  );
  if (invalidCustomPreReleaseMarkers.length > 0) {
    throw new Error(
      `Settings data.customPreReleaseMarkers contains invalid markers: ${invalidCustomPreReleaseMarkers.join(", ")}.`,
    );
  }
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
  assertOptionalField(
    persisted,
    "emailNotificationMode",
    isNotificationMode,
    "per_release or batch",
  );
  assertOptionalField(
    persisted,
    "appriseNotificationMode",
    isNotificationMode,
    "per_release or batch",
  );

  const definedPersisted = Object.fromEntries(
    Object.entries(persisted).filter(
      ([, fieldValue]) => fieldValue !== undefined,
    ),
  );
  const migratedPreReleaseConfiguration = migrateLegacyPreReleaseConfiguration(
    persisted.preReleaseSubChannels as string[] | undefined,
    persisted.customPreReleaseMarkers as string[] | undefined,
  );
  if (persisted.preReleaseSubChannels !== undefined) {
    definedPersisted.preReleaseSubChannels =
      migratedPreReleaseConfiguration.preReleaseSubChannels;
  }
  if (migratedPreReleaseConfiguration.customPreReleaseMarkers !== undefined) {
    definedPersisted.customPreReleaseMarkers =
      migratedPreReleaseConfiguration.customPreReleaseMarkers;
  }

  const merged = {
    ...defaultSettings,
    ...(definedPersisted as Partial<AppSettings>),
  };
  merged.customPreReleaseMarkers = normalizeCustomPreReleaseMarkers(
    merged.customPreReleaseMarkers,
  );
  merged.locale = parseLocale(merged.locale) ?? defaultLocale;
  merged.releaseSortOrder = normalizeReleaseSortOrder(merged.releaseSortOrder);
  merged.releaseSelectionStrategy = normalizeReleaseSelectionStrategy(
    merged.releaseSelectionStrategy,
  );
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

async function ensureCache(options: { forceMtimeCheck?: boolean } = {}) {
  await settingsStore.ensureExists();

  if (!cachedSettings) {
    await refreshCache();
    return;
  }

  const now = Date.now();
  if (
    !options.forceMtimeCheck &&
    now - lastMtimeCheck < CACHE_CHECK_INTERVAL_MS
  ) {
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
  // The proxy uses this value as the authority over locale cookies. Always
  // check the file metadata here so a settings update performed by another
  // Next.js route bundle cannot be hidden by the normal short-lived cache.
  await ensureCache({ forceMtimeCheck: true });
  const locale = cachedSettings?.locale;
  return parseLocale(locale) ?? defaultLocale;
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

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { logger } from "@/lib/logger";
import {
  normalizeProviderSortOrder,
  normalizeReleaseSortOrder,
} from "@/lib/release-sort";
import { checkForNewReleases } from "@/lib/releases/checker";
import { normalizeBackgroundCheckCron } from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getInvalidCustomSecurityPattern,
  normalizeSecurityHighlightColorPreset,
  normalizeSecurityHighlightCustomColor,
} from "@/lib/security-release";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
} from "@/lib/server-action-helpers";
import {
  buildGlobalSettingsChangeLog,
  getGlobalReleaseCacheInvalidationChanges,
  getReleaseCacheInvalidationReasons,
  shouldInvalidateReleaseCache,
} from "@/lib/settings/change-detection";
import { validateRegexInput } from "@/lib/settings/form-model";
import {
  NEXT_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  SETTINGS_LOCALE_COOKIE,
  settingsLocaleCookieOptions,
} from "@/lib/settings-locale-cookie";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import {
  getSettings,
  normalizeSettings,
  saveSettings,
} from "@/lib/storage/settings";
import type { AppSettings } from "@/types";

async function applySettingsUpdate(
  incomingSettings: AppSettings | Partial<AppSettings>,
  mergeWithCurrent: boolean,
) {
  let responseLocale = incomingSettings.locale;

  if (!(await isRestrictedActionAllowed())) {
    const restrictedActionError = await getRestrictedActionError();
    return {
      success: false,
      message: {
        title: restrictedActionError,
        description: restrictedActionError,
      },
    };
  }

  try {
    const currentSettings = await getSettings();
    const newSettings = normalizeSettings(
      mergeWithCurrent
        ? { ...currentSettings, ...incomingSettings }
        : incomingSettings,
    );
    responseLocale = newSettings.locale;

    const releaseCacheInvalidation = getGlobalReleaseCacheInvalidationChanges(
      currentSettings,
      newSettings,
    );
    const incomingCron = (newSettings.backgroundCheckCron ?? "").trim();
    const sanitizedBackgroundCheckCron = incomingCron
      ? normalizeBackgroundCheckCron(incomingCron)
      : undefined;

    if (incomingCron && !sanitizedBackgroundCheckCron) {
      const t = await getTranslations({
        locale: newSettings.locale,
        namespace: "SettingsForm",
      });
      return {
        success: false,
        message: {
          title: t("toast_error_title"),
          description: t("cron_error_invalid"),
        },
      };
    }

    const hasInvalidReleaseRegex = [
      newSettings.includeRegex,
      newSettings.excludeRegex,
    ].some(
      (value) =>
        typeof value === "string" && validateRegexInput(value) !== null,
    );
    if (hasInvalidReleaseRegex) {
      const t = await getTranslations({
        locale: newSettings.locale,
        namespace: "SettingsForm",
      });
      return {
        success: false,
        message: {
          title: t("toast_error_title"),
          description: t("regex_error_invalid"),
        },
      };
    }

    const invalidCustomSecurityPattern = getInvalidCustomSecurityPattern(
      newSettings.customSecurityPatterns,
    );
    if (invalidCustomSecurityPattern) {
      const t = await getTranslations({
        locale: newSettings.locale,
        namespace: "SettingsForm",
      });
      return {
        success: false,
        message: {
          title: t("toast_error_title"),
          description: t("security_patterns_error_invalid"),
        },
      };
    }

    // Ensure refreshInterval is at least 1
    const sanitizedParallelRepoFetches = (() => {
      const incoming = Number.isFinite(newSettings.parallelRepoFetches)
        ? Math.round(newSettings.parallelRepoFetches)
        : currentSettings.parallelRepoFetches;
      const fallback = Number.isFinite(incoming)
        ? incoming
        : currentSettings.parallelRepoFetches;
      const normalized = Number.isFinite(fallback) ? fallback : 1;
      return Math.min(Math.max(normalized, 1), 50);
    })();

    const settingsToSave = {
      ...newSettings,
      refreshInterval: Math.min(
        Math.max(1, Math.round(newSettings.refreshInterval)),
        5_256_000,
      ),
      cacheInterval: Math.min(
        Math.max(0, Math.round(newSettings.cacheInterval)),
        5_256_000,
      ),
      backgroundCheckCron: sanitizedBackgroundCheckCron,
      releasesPerPage: Math.min(
        Math.max(1, Math.round(newSettings.releasesPerPage)),
        1000,
      ),
      parallelRepoFetches: sanitizedParallelRepoFetches,
      includeRegex: newSettings.includeRegex?.trim() || undefined,
      excludeRegex: newSettings.excludeRegex?.trim() || undefined,
      appriseTags: newSettings.appriseTags?.trim() || undefined,
      appriseMaxCharacters: Math.max(
        0,
        Math.round(newSettings.appriseMaxCharacters ?? 1800),
      ),
      releaseSortOrder: normalizeReleaseSortOrder(newSettings.releaseSortOrder),
      providerSortOrder: normalizeProviderSortOrder(
        newSettings.providerSortOrder,
      ),
      securityHighlightColorPreset: normalizeSecurityHighlightColorPreset(
        newSettings.securityHighlightColorPreset,
      ),
      securityHighlightCustomColor: normalizeSecurityHighlightCustomColor(
        newSettings.securityHighlightCustomColor,
      ),
      customSecurityPatterns:
        newSettings.customSecurityPatterns?.trim() || undefined,
      includeDefaultSecurityPatterns:
        newSettings.includeDefaultSecurityPatterns !== false,
      confirmSecurityAcknowledge:
        newSettings.confirmSecurityAcknowledge === true,
    };

    const changes = buildGlobalSettingsChangeLog(
      currentSettings,
      settingsToSave,
    );

    const shouldResetNewFlags =
      currentSettings.showAcknowledge &&
      settingsToSave.showAcknowledge === false;
    const shouldClearEtags = shouldInvalidateReleaseCache(
      releaseCacheInvalidation,
    );

    // All validation is complete before any persistent side effects begin.
    if (shouldResetNewFlags || shouldClearEtags) {
      const allRepos = await getRepositories();
      const updatedRepos = allRepos.map((repository) => ({
        ...repository,
        isNew: shouldResetNewFlags ? false : repository.isNew,
        etag: shouldClearEtags ? undefined : repository.etag,
      }));
      await saveRepositories(updatedRepos);
    }

    if (shouldResetNewFlags) {
      logger
        .withScope("Settings")
        .info(
          "Disabling 'Mark as seen' feature. Resetting all 'isNew' flags to false.",
        );
    }

    // If regex changed globally, clear ETags so next fetch doesn't short-circuit on 304
    if (shouldClearEtags) {
      const reasons = getReleaseCacheInvalidationReasons(
        releaseCacheInvalidation,
        { filtersReason: "regexChanged" },
      );
      logger
        .withScope("Settings")
        .info(
          `Cleared ETags for all repositories due to: ${reasons.join(", ")}`,
        );
    }

    await saveSettings(settingsToSave);
    if (changes.length > 0) {
      logger
        .withScope("Settings")
        .info(`Global settings updated: ${changes.join("; ")}`);
    } else {
      logger.withScope("Settings").info("Global settings saved (no changes).");
    }

    // Only trigger refresh if filter/pagination settings changed (not UI or Apprise settings)
    if (shouldClearEtags) {
      logger
        .withScope("Settings")
        .info("Filter/API settings changed - triggering repository refresh");
      checkForNewReleases({ skipCache: true });
    }

    // Set the locale cookie for next-intl middleware to pick up.
    // This is now done on every save, not just on change, to ensure consistency.
    const cookieStore = await cookies();
    cookieStore.set(
      NEXT_LOCALE_COOKIE,
      newSettings.locale,
      nextLocaleCookieOptions,
    );
    cookieStore.set(
      SETTINGS_LOCALE_COOKIE,
      newSettings.locale,
      settingsLocaleCookieOptions,
    );

    revalidatePath("/");
    revalidatePath("/settings");

    const t = await getTranslations({
      locale: responseLocale ?? (await getLocale()),
      namespace: "SettingsForm",
    });
    return {
      success: true,
      message: {
        title: t("toast_success_title"),
        description: t("toast_success_description"),
      },
    };
  } catch (error: unknown) {
    logger.withScope("Settings").error("Failed to save settings:", error);
    const t = await getTranslations({
      locale: responseLocale ?? (await getLocale()),
      namespace: "SettingsForm",
    });
    return {
      success: false,
      message: {
        title: t("toast_error_title"),
        description: t("toast_error_description"),
      },
    };
  }
}

function updateSettings(
  incomingSettings: AppSettings | Partial<AppSettings>,
  mergeWithCurrent: boolean,
) {
  return scheduleTask(
    mergeWithCurrent ? "updateSettingsPatchAction" : "updateSettingsAction",
    () => applySettingsUpdate(incomingSettings, mergeWithCurrent),
  );
}

export async function updateSettingsAction(newSettings: AppSettings) {
  return updateSettings(newSettings, false);
}

export async function updateSettingsPatchAction(
  settingsPatch: Partial<AppSettings>,
) {
  return updateSettings(settingsPatch, true);
}

export async function deleteAllRepositoriesAction() {
  return scheduleTask("deleteAllRepositoriesAction", async () => {
    if (!(await isRestrictedActionAllowed())) {
      const restrictedActionError = await getRestrictedActionError();
      return {
        success: false,
        message: {
          title: restrictedActionError,
          description: restrictedActionError,
        },
      };
    }

    try {
      await saveRepositories([]);
      logger.withScope("Settings").info("Deleted all repositories.");
      revalidatePath("/");

      const locale = await getLocale();
      const t = await getTranslations({
        locale,
        namespace: "SettingsForm",
      });
      return {
        success: true,
        message: {
          title: t("toast_delete_all_success_title"),
          description: t("toast_delete_all_success_description"),
        },
      };
    } catch (error: unknown) {
      logger
        .withScope("Settings")
        .error("Failed to delete all repositories:", error);
      const locale = await getLocale();
      const t = await getTranslations({
        locale,
        namespace: "SettingsForm",
      });
      return {
        success: false,
        message: {
          title: t("toast_error_title"),
          description:
            error instanceof Error && error.message
              ? error.message
              : t("toast_delete_all_error_description"),
        },
      };
    }
  });
}

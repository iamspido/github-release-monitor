"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { logger } from "@/lib/logger";
import { checkForNewReleases } from "@/lib/releases/checker";
import { trackBackgroundTask } from "@/lib/runtime/background-tasks";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
} from "@/lib/server-action-helpers";
import { getReleaseCacheInvalidationReasons } from "@/lib/settings/change-detection";
import { prepareSettingsUpdate } from "@/lib/settings/update-command";
import {
  NEXT_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  SETTINGS_LOCALE_COOKIE,
  settingsLocaleCookieOptions,
} from "@/lib/settings-locale-cookie";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings, saveSettings } from "@/lib/storage/settings";
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
    const preparedUpdate = prepareSettingsUpdate(
      incomingSettings,
      currentSettings,
      mergeWithCurrent,
    );
    if (!preparedUpdate.ok) {
      responseLocale = preparedUpdate.locale;
      const t = await getTranslations({
        locale: preparedUpdate.locale,
        namespace: "SettingsForm",
      });
      return {
        success: false,
        message: {
          title: t("toast_error_title"),
          description: preparedUpdate.errorValues
            ? `${t(preparedUpdate.errorKey)} ${preparedUpdate.errorValues.join(", ")}`
            : t(preparedUpdate.errorKey),
        },
      };
    }
    const {
      changes,
      releaseCacheInvalidation,
      settingsToSave,
      shouldClearEtags,
      shouldRebaselineReleaseSelection,
      shouldResetNewFlags,
    } = preparedUpdate.value;
    responseLocale = settingsToSave.locale;
    let repositoriesBeforeSettingsUpdate: Awaited<
      ReturnType<typeof getRepositories>
    > | null = null;
    const selectionStrategyIsOnlyCacheChange =
      releaseCacheInvalidation.releaseSelectionStrategyChanged === true &&
      !releaseCacheInvalidation.filtersChanged &&
      !releaseCacheInvalidation.releaseChannelsChanged &&
      !releaseCacheInvalidation.preReleaseSubChannelsChanged &&
      !releaseCacheInvalidation.customPreReleaseMarkersChanged &&
      !releaseCacheInvalidation.releasesPerPageChanged;

    // All validation is complete before any persistent side effects begin.
    if (
      shouldResetNewFlags ||
      shouldClearEtags ||
      shouldRebaselineReleaseSelection
    ) {
      const allRepos = await getRepositories();
      repositoriesBeforeSettingsUpdate = allRepos;
      const updatedRepos = allRepos.map((repository) => {
        const shouldRebaselineRepository =
          shouldRebaselineReleaseSelection &&
          repository.releaseSelectionStrategy === undefined;
        const shouldClearRepositoryEtag =
          shouldClearEtags &&
          (!selectionStrategyIsOnlyCacheChange || shouldRebaselineRepository);
        return {
          ...repository,
          lastSeenReleaseTag: shouldRebaselineRepository
            ? undefined
            : repository.lastSeenReleaseTag,
          isNew:
            shouldResetNewFlags || shouldRebaselineRepository
              ? false
              : repository.isNew,
          etag: shouldClearRepositoryEtag ? undefined : repository.etag,
        };
      });
      await saveRepositories(updatedRepos);
    }

    try {
      await saveSettings(settingsToSave);
    } catch (settingsError) {
      if (repositoriesBeforeSettingsUpdate) {
        try {
          await saveRepositories(repositoriesBeforeSettingsUpdate);
        } catch (rollbackError) {
          logger
            .withScope("Settings")
            .error(
              "Failed to roll back repository changes after settings persistence failed.",
              rollbackError,
            );
        }
      }
      throw settingsError;
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
          selectionStrategyIsOnlyCacheChange
            ? `Cleared ETags for repositories inheriting the global release selection due to: ${reasons.join(", ")}`
            : `Cleared ETags for all repositories due to: ${reasons.join(", ")}`,
        );
    }
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
      trackBackgroundTask(
        checkForNewReleases({ skipCache: true }).catch((error) => {
          logger
            .withScope("Settings")
            .error("Repository refresh after settings update failed.", error);
        }),
      );
    }

    // Set the locale cookie for next-intl middleware to pick up.
    // This is now done on every save, not just on change, to ensure consistency.
    const cookieStore = await cookies();
    cookieStore.set(
      NEXT_LOCALE_COOKIE,
      settingsToSave.locale,
      nextLocaleCookieOptions,
    );
    cookieStore.set(
      SETTINGS_LOCALE_COOKIE,
      settingsToSave.locale,
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

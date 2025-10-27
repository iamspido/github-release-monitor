"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { checkForNewReleases } from "@/app/actions";
import { logger } from "@/lib/logger";
import { getRepositories, saveRepositories } from "@/lib/repository-storage";
import {
  NEXT_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  SETTINGS_LOCALE_COOKIE,
  settingsLocaleCookieOptions,
} from "@/lib/settings-locale-cookie";
import { getSettings, saveSettings } from "@/lib/settings-storage";
import { scheduleTask } from "@/lib/task-scheduler";
import type { AppSettings } from "@/types";

export async function updateSettingsAction(newSettings: AppSettings) {
  return scheduleTask("updateSettingsAction", async () => {
    try {
      const currentSettings = await getSettings();

      // If the "mark as seen" feature is being disabled, reset all isNew flags.
      if (
        currentSettings.showAcknowledge &&
        newSettings.showAcknowledge === false
      ) {
        logger
          .withScope("Settings")
          .info(
            "Disabling 'Mark as seen' feature. Resetting all 'isNew' flags to false.",
          );
        const allRepos = await getRepositories();
        const updatedRepos = allRepos.map((repo) => ({
          ...repo,
          isNew: false,
        }));
        await saveRepositories(updatedRepos);
      }

      // Detect if regex filters changed (affects local filtering and should bypass ETag once)
      const prevInclude =
        (currentSettings.includeRegex ?? "").trim() || undefined;
      const prevExclude =
        (currentSettings.excludeRegex ?? "").trim() || undefined;
      const nextInclude = (newSettings.includeRegex ?? "").trim() || undefined;
      const nextExclude = (newSettings.excludeRegex ?? "").trim() || undefined;
      const regexChanged =
        prevInclude !== nextInclude || prevExclude !== nextExclude;

      // Compare arrays ignoring order
      const normArray = <T>(arr?: T[] | null) => {
        if (!arr || arr.length === 0) return [] as T[];
        return [...arr].sort();
      };
      const channelsChanged =
        JSON.stringify(normArray(currentSettings.releaseChannels)) !==
        JSON.stringify(normArray(newSettings.releaseChannels));
      const preSubsChanged =
        JSON.stringify(normArray(currentSettings.preReleaseSubChannels)) !==
        JSON.stringify(normArray(newSettings.preReleaseSubChannels));
      const rppChanged =
        currentSettings.releasesPerPage !== newSettings.releasesPerPage;

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
        refreshInterval: Math.max(1, newSettings.refreshInterval),
        cacheInterval: Math.max(0, newSettings.cacheInterval),
        parallelRepoFetches: sanitizedParallelRepoFetches,
        includeRegex: newSettings.includeRegex?.trim() || undefined,
        excludeRegex: newSettings.excludeRegex?.trim() || undefined,
        appriseTags: newSettings.appriseTags?.trim() || undefined,
      };

      // Compute a concise diff of global settings
      const oldS = currentSettings;
      const newS = settingsToSave;
      const changes: string[] = [];
      const fmt = (value: unknown): string => {
        if (value === undefined) return "undefined";
        const serialized = JSON.stringify(value);
        return serialized ?? String(value);
      };
      const cmpArr = (a?: unknown[] | null, b?: unknown[] | null) =>
        JSON.stringify((a ?? []).slice().sort()) ===
        JSON.stringify((b ?? []).slice().sort());
      const pushValueChange = (
        label: string,
        previous: unknown,
        next: unknown,
      ) => {
        if (!Object.is(previous, next)) {
          changes.push(`${label}: ${fmt(previous)} -> ${fmt(next)}`);
        }
      };
      const pushArrayChange = (
        label: string,
        previous?: unknown[] | null,
        next?: unknown[] | null,
      ) => {
        if (!cmpArr(previous, next)) {
          changes.push(`${label}: ${fmt(previous)} -> ${fmt(next)}`);
        }
      };
      pushValueChange("timeFormat", oldS.timeFormat, newS.timeFormat);
      pushValueChange("locale", oldS.locale, newS.locale);
      pushValueChange(
        "refreshInterval",
        oldS.refreshInterval,
        newS.refreshInterval,
      );
      pushValueChange("cacheInterval", oldS.cacheInterval, newS.cacheInterval);
      pushValueChange(
        "releasesPerPage",
        oldS.releasesPerPage,
        newS.releasesPerPage,
      );
      pushValueChange(
        "parallelRepoFetches",
        oldS.parallelRepoFetches,
        newS.parallelRepoFetches,
      );
      pushArrayChange(
        "releaseChannels",
        oldS.releaseChannels,
        newS.releaseChannels,
      );
      pushArrayChange(
        "preReleaseSubChannels",
        oldS.preReleaseSubChannels,
        newS.preReleaseSubChannels,
      );
      pushValueChange(
        "showAcknowledge",
        oldS.showAcknowledge,
        newS.showAcknowledge,
      );
      pushValueChange("showMarkAsNew", oldS.showMarkAsNew, newS.showMarkAsNew);
      pushValueChange("includeRegex", oldS.includeRegex, newS.includeRegex);
      pushValueChange("excludeRegex", oldS.excludeRegex, newS.excludeRegex);
      pushValueChange(
        "appriseMaxCharacters",
        oldS.appriseMaxCharacters,
        newS.appriseMaxCharacters,
      );
      pushValueChange("appriseTags", oldS.appriseTags, newS.appriseTags);
      pushValueChange("appriseFormat", oldS.appriseFormat, newS.appriseFormat);

      // If regex changed globally, clear ETags so next fetch doesn't short-circuit on 304
      if (regexChanged || channelsChanged || preSubsChanged || rppChanged) {
        const allRepos = await getRepositories();
        const cleared = allRepos.map((repository) => ({
          ...repository,
          etag: undefined,
        }));
        await saveRepositories(cleared);
        const reasons: string[] = [];
        if (regexChanged) reasons.push("regexChanged");
        if (channelsChanged) reasons.push("releaseChannelsChanged");
        if (preSubsChanged) reasons.push("preReleaseSubChannelsChanged");
        if (rppChanged) reasons.push("releasesPerPageChanged");
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
        logger
          .withScope("Settings")
          .info("Global settings saved (no changes).");
      }

      // Only trigger refresh if filter/pagination settings changed (not UI or Apprise settings)
      if (regexChanged || channelsChanged || preSubsChanged || rppChanged) {
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
        locale: newSettings.locale,
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
        locale: newSettings.locale,
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
  });
}

export async function deleteAllRepositoriesAction() {
  return scheduleTask("deleteAllRepositoriesAction", async () => {
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

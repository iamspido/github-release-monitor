import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import {
  getInvalidCustomPreReleaseMarkers,
  normalizeCustomPreReleaseMarkers,
} from "@/lib/releases/pre-release-markers";
import {
  normalizeReleaseSelectionStrategy,
  resolveEffectiveReleaseSelectionStrategy,
} from "@/lib/releases/selection";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { isValidRepoId } from "@/lib/repositories/validation";
import {
  normalizeBackgroundCheckCron,
  normalizeCacheInterval,
  normalizeRefreshInterval,
} from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
} from "@/lib/server-action-helpers";
import {
  buildRepositorySettingsChangeLog,
  getReleaseCacheInvalidationReasons,
  getRepositoryReleaseCacheInvalidationChanges,
  shouldInvalidateReleaseCache,
} from "@/lib/settings/change-detection";
import { validateRegexInput } from "@/lib/settings/form-model";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { Repository } from "@/types";

export async function updateRepositorySettingsAction(
  repoId: string,
  settings: Pick<
    Repository,
    | "displayName"
    | "isPinned"
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "customPreReleaseMarkers"
    | "releaseSelectionStrategy"
    | "versionTagPattern"
    | "releasesPerPage"
    | "refreshInterval"
    | "cacheInterval"
    | "backgroundCheckCron"
    | "includeRegex"
    | "excludeRegex"
    | "tags"
    | "appriseTags"
    | "appriseFormat"
  >,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`updateRepositorySettingsAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }

    const locale = await getLocale();
    const t = await getTranslations({
      locale,
      namespace: "RepoSettingsDialog",
    });

    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex === -1) {
        return { success: false, error: t("toast_error_not_found") };
      }

      const existing = currentRepos[repoIndex];
      const newReleaseSelectionStrategy = settings.releaseSelectionStrategy
        ? normalizeReleaseSelectionStrategy(settings.releaseSelectionStrategy)
        : undefined;
      const newVersionTagPattern =
        settings.versionTagPattern?.trim() || undefined;
      const versionTagPatternError =
        validateVersionTagPattern(newVersionTagPattern);
      if (versionTagPatternError) {
        return {
          success: false,
          error: t(
            versionTagPatternError === "missing_version_group"
              ? "version_tag_pattern_error_missing_version_group"
              : "version_tag_pattern_error_invalid",
          ),
        };
      }
      const versionTagPatternChanged =
        (existing.versionTagPattern?.trim() || undefined) !==
        newVersionTagPattern;
      const releaseSelectionOverrideChanged =
        existing.releaseSelectionStrategy !== newReleaseSelectionStrategy;
      let effectiveReleaseSelectionChanged = false;
      if (releaseSelectionOverrideChanged) {
        const globalSettings = await getSettings();
        effectiveReleaseSelectionChanged =
          resolveEffectiveReleaseSelectionStrategy(
            existing,
            globalSettings.releaseSelectionStrategy,
          ) !==
          resolveEffectiveReleaseSelectionStrategy(
            { releaseSelectionStrategy: newReleaseSelectionStrategy },
            globalSettings.releaseSelectionStrategy,
          );
      }

      const hasDisplayNameUpdate = Object.hasOwn(settings, "displayName");
      const normalizedDisplayName = normalizeRepositoryDisplayName(
        hasDisplayNameUpdate ? settings.displayName : existing.displayName,
      );
      if (!normalizedDisplayName.success) {
        return { success: false, error: t("display_name_error_invalid") };
      }

      let newTags = existing.tags;
      if (settings.tags !== undefined) {
        const normalizedTags = normalizeRepositoryTags(settings.tags);
        if (!normalizedTags.success) {
          return { success: false, error: t("tags_error_invalid") };
        }
        newTags =
          normalizedTags.tags.length > 0 ? normalizedTags.tags : undefined;
      }

      const newIsPinned = Object.hasOwn(settings, "isPinned")
        ? settings.isPinned === true
          ? true
          : undefined
        : existing.isPinned;

      const newInclude = (settings.includeRegex ?? "").trim() || undefined;
      const newExclude = (settings.excludeRegex ?? "").trim() || undefined;
      const invalidCustomPreReleaseMarkers = getInvalidCustomPreReleaseMarkers(
        settings.customPreReleaseMarkers,
      );
      if (invalidCustomPreReleaseMarkers.length > 0) {
        const tSettings = await getTranslations({
          locale,
          namespace: "SettingsForm",
        });
        return {
          success: false,
          error: `${tSettings("custom_prerelease_markers_error_invalid")} ${invalidCustomPreReleaseMarkers.join(", ")}`,
        };
      }
      const newCustomPreReleaseMarkers =
        settings.customPreReleaseMarkers === undefined
          ? undefined
          : normalizeCustomPreReleaseMarkers(settings.customPreReleaseMarkers);
      if (
        (newInclude && validateRegexInput(newInclude)) ||
        (newExclude && validateRegexInput(newExclude))
      ) {
        return { success: false, error: t("regex_error_invalid") };
      }
      const cronInput = (settings.backgroundCheckCron ?? "").trim();
      const newBackgroundCheckCron = cronInput
        ? normalizeBackgroundCheckCron(cronInput)
        : undefined;

      if (cronInput && !newBackgroundCheckCron) {
        return { success: false, error: t("cron_error_invalid") };
      }

      const newRefreshInterval = newBackgroundCheckCron
        ? null
        : typeof settings.refreshInterval === "number"
          ? (normalizeRefreshInterval(settings.refreshInterval) ?? null)
          : null;
      const newCacheInterval =
        typeof settings.cacheInterval === "number"
          ? (normalizeCacheInterval(settings.cacheInterval) ?? null)
          : null;

      const releaseCacheInvalidation =
        getRepositoryReleaseCacheInvalidationChanges(existing, {
          ...settings,
          releaseSelectionStrategy: newReleaseSelectionStrategy,
          versionTagPattern: newVersionTagPattern,
          customPreReleaseMarkers: newCustomPreReleaseMarkers,
        });
      const backgroundCheckCronChanged =
        (existing.backgroundCheckCron ?? undefined) !== newBackgroundCheckCron;

      const changes = buildRepositorySettingsChangeLog(
        existing,
        {
          ...settings,
          releaseSelectionStrategy: newReleaseSelectionStrategy,
          versionTagPattern: newVersionTagPattern,
          customPreReleaseMarkers: newCustomPreReleaseMarkers,
          displayName: normalizedDisplayName.displayName,
          isPinned: newIsPinned,
          tags: newTags,
        },
        {
          refreshInterval: newRefreshInterval,
          cacheInterval: newCacheInterval,
          backgroundCheckCron: newBackgroundCheckCron,
        },
      );

      const etagInvalidated = shouldInvalidateReleaseCache(
        releaseCacheInvalidation,
      );

      currentRepos[repoIndex] = {
        ...existing,
        displayName: normalizedDisplayName.displayName,
        isPinned: newIsPinned,
        releaseChannels: settings.releaseChannels,
        preReleaseSubChannels: settings.preReleaseSubChannels,
        customPreReleaseMarkers: newCustomPreReleaseMarkers,
        releaseSelectionStrategy: newReleaseSelectionStrategy,
        versionTagPattern: newVersionTagPattern,
        releasesPerPage: settings.releasesPerPage,
        refreshInterval: newRefreshInterval,
        cacheInterval: newCacheInterval,
        backgroundCheckCron: newBackgroundCheckCron,
        lastBackgroundCheckAt: backgroundCheckCronChanged
          ? undefined
          : existing.lastBackgroundCheckAt,
        includeRegex: newInclude,
        excludeRegex: newExclude,
        tags: newTags,
        appriseTags: settings.appriseTags,
        appriseFormat: settings.appriseFormat,
        lastSeenReleaseTag:
          effectiveReleaseSelectionChanged || versionTagPatternChanged
            ? undefined
            : existing.lastSeenReleaseTag,
        isNew:
          effectiveReleaseSelectionChanged || versionTagPatternChanged
            ? false
            : existing.isNew,
        // Invalidate ETag when filters/pagination that affect visible latest release change
        etag: etagInvalidated ? undefined : existing.etag,
      };

      await saveRepositories(currentRepos);
      revalidatePath("/");
      if (etagInvalidated) {
        const reasons = getReleaseCacheInvalidationReasons(
          releaseCacheInvalidation,
        );
        log.info(`Cleared ETag for ${repoId} due to: ${reasons.join(", ")}`);
      }
      if (changes.length > 0) {
        log.info(
          `Updated repository settings for ${repoId}: ${changes.join("; ")}`,
        );
      } else {
        log.info(`Updated repository settings for ${repoId}: no changes.`);
      }
      return { success: true };
    } catch (error: unknown) {
      log.error(`Failed to update settings for ${repoId}:`, error);
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      return {
        success: false,
        error: message || t("toast_error_generic"),
      };
    }
  });
}

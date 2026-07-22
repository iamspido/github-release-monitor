import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { getLatestReleasesForRepos } from "@/lib/releases";
import { resolveEffectiveRepoFilters } from "@/lib/releases/filters";
import {
  normalizeReleaseSelectionStrategy,
  resolveEffectiveReleaseSelectionStrategy,
} from "@/lib/releases/selection";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import { normalizeRepositoryDisplayName } from "@/lib/repositories/display-name";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
import { toPublicRepository } from "@/lib/repositories/public-repository";
import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import { parseImportedRepository } from "@/lib/repositories/repository-import";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { isValidRepoId } from "@/lib/repositories/validation";
import { trackBackgroundTask } from "@/lib/runtime/background-tasks";
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
  updateReleaseCacheTags,
} from "@/lib/server-action-helpers";
import {
  buildRepositorySettingsChangeLog,
  getReleaseCacheInvalidationReasons,
  getRepositoryReleaseCacheInvalidationChanges,
  shouldInvalidateReleaseCache,
} from "@/lib/settings/change-detection";
import { validateRegexInput } from "@/lib/settings/form-model";
import { getJobStatus, type JobStatus, setJobStatus } from "@/lib/storage/jobs";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings, Repository } from "@/types";

function createReleaseFetchFingerprint(
  repository: Repository,
  settings: AppSettings,
): string {
  const filters = resolveEffectiveRepoFilters(repository, settings);
  return JSON.stringify({
    url: repository.url,
    locale: settings.locale,
    releaseChannels: [...filters.effectiveReleaseChannels].sort(),
    preReleaseSubChannels: [...filters.effectivePreReleaseSubChannels].sort(),
    releaseSelectionStrategy: filters.effectiveReleaseSelectionStrategy,
    versionTagPattern: filters.versionTagPattern,
    releasesPerPage: filters.totalReleasesToFetch,
    includeRegex: filters.effectiveIncludeRegex,
    excludeRegex: filters.effectiveExcludeRegex,
    etag: repository.etag,
    latestRelease: repository.latestRelease,
  });
}

export async function addRepositoriesAction(
  _prevState: unknown,
  formData: FormData,
): Promise<{
  success: boolean;
  toast?: { title: string; description: string };
  error?: string;
  jobId?: string;
}> {
  return scheduleTask("addRepositoriesAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "RepositoryForm" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    const urls = formData.get("urls");
    if (typeof urls !== "string" || !urls.trim()) {
      return {
        success: false,
        error: t("toast_fail_description_manual", { failed: 1 }),
      };
    }

    const normalizedTags = normalizeRepositoryTags(formData.getAll("tags"));
    if (!normalizedTags.success) {
      return { success: false, error: t("tags_error_invalid") };
    }
    const selectedTags =
      normalizedTags.tags.length > 0 ? normalizedTags.tags : undefined;

    const urlList = urls.split("\n").filter((u) => u.trim() !== "");
    const newRepos: Repository[] = [];
    let failedCount = 0;

    for (const url of urlList) {
      const parsed = parseSupportedRepoUrl(url);
      if (parsed) {
        newRepos.push({
          id: parsed.id,
          url: parsed.canonicalRepoUrl,
          tags: selectedTags,
        });
      } else {
        failedCount++;
      }
    }

    if (newRepos.length === 0 && failedCount > 0) {
      return {
        success: false,
        error: t("toast_fail_description_manual", { failed: failedCount }),
      };
    }

    try {
      const currentRepos = await getRepositories();
      const existingIds = new Set(currentRepos.map((r) => r.id));
      const uniqueNewRepos = newRepos.filter((r) => !existingIds.has(r.id));
      let jobId: string | undefined;

      if (uniqueNewRepos.length > 0) {
        await saveRepositories([...currentRepos, ...uniqueNewRepos]);
        revalidatePath("/");

        jobId = crypto.randomUUID();
        setJobStatus(jobId, "pending");
        trackBackgroundTask(
          refreshMultipleRepositoriesAction(
            uniqueNewRepos.map((r) => r.id),
            jobId,
          ),
        );
      }

      const addedCount = uniqueNewRepos.length;
      const skippedCount = newRepos.length - addedCount;

      log.info(
        `Add repositories: added=${addedCount} skipped=${skippedCount} failed=${failedCount}`,
      );
      if (addedCount > 0 && jobId) {
        log.debug(
          `Queued background refresh jobId=${jobId} for ${addedCount} repos`,
        );
      }

      return {
        success: true,
        toast: {
          title: t("toast_success_title"),
          description: t("toast_success_description_manual", {
            added: addedCount,
            skipped: skippedCount,
            failed: failedCount,
          }),
        },
        jobId: addedCount > 0 ? jobId : undefined,
      };
    } catch (error: unknown) {
      log.error("Failed to add repositories:", error);
      return {
        success: false,
        error: t("toast_save_error_generic"),
      };
    }
  });
}

export async function importRepositoriesAction(
  importedData: Repository[],
  selectedTags: readonly string[] = [],
): Promise<{
  success: boolean;
  message: string;
  jobId?: string;
}> {
  return scheduleTask("importRepositoriesAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "RepositoryForm" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, message: await getRestrictedActionError() };
    }
    const settings = await getSettings();

    try {
      const normalizedSelectedTags = normalizeRepositoryTags(selectedTags);
      if (!normalizedSelectedTags.success) {
        return { success: false, message: t("tags_error_invalid") };
      }

      const currentRepos = await getRepositories();
      const currentRepoIds = new Set(currentRepos.map((repo) => repo.id));
      const currentReposMap = new Map(currentRepos.map((r) => [r.id, r]));

      const validImportedRepos = importedData.flatMap((repo) => {
        const parsed = parseImportedRepository(repo);
        return parsed ? [parsed] : [];
      });

      let addedCount = 0;
      let updatedCount = 0;
      const reposToFetch: Repository[] = [];

      for (const parsedImportedRepo of validImportedRepos) {
        let importedRepo = parsedImportedRepo;
        if (normalizedSelectedTags.tags.length > 0) {
          const currentTags = currentReposMap.get(importedRepo.id)?.tags ?? [];
          const mergedTags = normalizeRepositoryTags([
            ...currentTags,
            ...(importedRepo.tags ?? []),
            ...normalizedSelectedTags.tags,
          ]);
          if (!mergedTags.success) {
            return { success: false, message: t("tags_error_invalid") };
          }
          importedRepo = { ...importedRepo, tags: mergedTags.tags };
        }

        if (currentRepoIds.has(importedRepo.id)) {
          updatedCount++;
        } else {
          addedCount++;
        }

        const existingRepo = currentReposMap.get(importedRepo.id);
        const repoToSave: Repository = {
          ...existingRepo,
          ...importedRepo,
          isNew:
            (settings.showAcknowledge ?? true)
              ? (importedRepo.isNew ?? false)
              : false,
        };
        const releaseSelectionConfigChanged =
          existingRepo &&
          (resolveEffectiveReleaseSelectionStrategy(
            existingRepo,
            settings.releaseSelectionStrategy,
          ) !==
            resolveEffectiveReleaseSelectionStrategy(
              repoToSave,
              settings.releaseSelectionStrategy,
            ) ||
            (existingRepo.versionTagPattern?.trim() || undefined) !==
              (repoToSave.versionTagPattern?.trim() || undefined));
        if (releaseSelectionConfigChanged) {
          if (!Object.hasOwn(importedRepo, "lastSeenReleaseTag")) {
            delete repoToSave.lastSeenReleaseTag;
          }
          if (!Object.hasOwn(importedRepo, "etag")) {
            delete repoToSave.etag;
          }
        }
        currentReposMap.set(importedRepo.id, repoToSave);
        reposToFetch.push(repoToSave);
      }

      const finalList = Array.from(currentReposMap.values());
      await saveRepositories(finalList);
      revalidatePath("/");

      let jobId: string | undefined;
      if (reposToFetch.length > 0) {
        jobId = crypto.randomUUID();
        setJobStatus(jobId, "pending");
        const repoIds = reposToFetch.map((r) => r.id);
        trackBackgroundTask(refreshMultipleRepositoriesAction(repoIds, jobId));
      }

      log.info(
        `Import repositories: added=${addedCount} updated=${updatedCount}`,
      );
      return {
        success: true,
        message: t("toast_import_success_description", {
          addedCount,
          updatedCount,
        }),
        jobId: reposToFetch.length > 0 ? jobId : undefined,
      };
    } catch (error: unknown) {
      log.error("Failed to import repositories:", error);
      return {
        success: false,
        message: t("toast_save_error_generic"),
      };
    }
  });
}

export async function refreshSingleRepositoryAction(repoId: string) {
  const snapshot = await scheduleTask(
    `refreshSingleRepositoryAction: ${repoId}`,
    async () => {
      if (!(await isRestrictedActionAllowed())) {
        return;
      }

      if (!isValidRepoId(repoId)) {
        log.error("Invalid repoId format for refresh:", repoId);
        return;
      }

      log.info(`Refreshing single repository: ${repoId}`);

      const settings = await getSettings();
      const allRepos = await getRepositories();
      const repository = allRepos.find((repo) => repo.id === repoId);

      if (!repository) {
        log.error(`Repository ${repoId} not found for refresh.`);
        return;
      }

      return {
        repository,
        settings,
        fingerprint: createReleaseFetchFingerprint(repository, settings),
      };
    },
  );

  if (!snapshot) return;

  const enrichedReleases = await getLatestReleasesForRepos(
    [snapshot.repository],
    snapshot.settings,
    snapshot.settings.locale,
    { skipCache: true },
  );
  const enrichedRelease = enrichedReleases[0];
  if (!enrichedRelease) {
    log.error(`Failed to get release for ${repoId} during single refresh.`);
    return;
  }

  return scheduleTask(`commitRefreshSingleRepository: ${repoId}`, async () => {
    const [allRepos, currentSettings] = await Promise.all([
      getRepositories(),
      getSettings(),
    ]);
    const repoIndex = allRepos.findIndex((repo) => repo.id === repoId);
    if (repoIndex === -1) return;

    if (
      snapshot.fingerprint !==
      createReleaseFetchFingerprint(allRepos[repoIndex], currentSettings)
    ) {
      log.info(
        `Skipped stale single refresh result for ${repoId} because its effective fetch inputs changed.`,
      );
      return;
    }

    applyReleaseFetchResultToRepository(allRepos[repoIndex], enrichedRelease, {
      initializeLastSeenFromRealRelease: true,
    });

    await saveRepositories(allRepos);
    revalidatePath("/");
  });
}

export async function refreshMultipleRepositoriesAction(
  repoIds: string[],
  jobId: string,
) {
  try {
    log.info(
      `Refresh multiple repositories start: count=${repoIds.length} jobId=${jobId}`,
    );
    const settings = await getSettings();
    const locale = settings.locale;
    const allRepos = await getRepositories();
    const reposToRefresh = allRepos.filter((r) => repoIds.includes(r.id));

    if (reposToRefresh.length > 0) {
      const fetchFingerprints = new Map(
        reposToRefresh.map((repository) => [
          repository.id,
          createReleaseFetchFingerprint(repository, settings),
        ]),
      );
      const enrichedReleases = await getLatestReleasesForRepos(
        reposToRefresh,
        settings,
        locale,
        { skipCache: true },
      );

      const enrichedMap = new Map(enrichedReleases.map((r) => [r.repoId, r]));
      await scheduleTask(
        `commitRefreshMultipleRepositories: ${jobId}`,
        async () => {
          // Re-read after the network phase so concurrent deletes, imports, and
          // unrelated settings changes are preserved. Results whose effective
          // fetch inputs changed are left for the next refresh.
          const currentRepos = await getRepositories();
          const currentSettings = await getSettings();
          for (const repo of currentRepos) {
            const enriched = enrichedMap.get(repo.id);
            const fetchFingerprint = fetchFingerprints.get(repo.id);
            if (
              enriched &&
              fetchFingerprint ===
                createReleaseFetchFingerprint(repo, currentSettings)
            ) {
              applyReleaseFetchResultToRepository(repo, enriched, {
                initializeLastSeenFromRealRelease: true,
              });
            } else if (enriched && fetchFingerprint) {
              log.info(
                `Skipped stale background refresh result for ${repo.id} because its effective fetch inputs changed.`,
              );
            }
          }
          await saveRepositories(currentRepos);
        },
      );
    }
    setJobStatus(jobId, "complete");
    log.info(`Refresh multiple repositories complete: jobId=${jobId}`);
  } catch (error) {
    log.error(`[Job ${jobId}] Failed to refresh repositories:`, error);
    setJobStatus(jobId, "error");
  }
}

export async function removeRepositoryAction(repoId: string) {
  return scheduleTask(`removeRepositoryAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return;
    }

    if (!isValidRepoId(repoId)) {
      log.error("Invalid repoId format for removal:", repoId);
      return;
    }
    const currentRepos = await getRepositories();
    const newRepos = currentRepos.filter((r) => r.id !== repoId);
    await saveRepositories(newRepos);
    log.info(`Removed repository: ${repoId}`);
    revalidatePath("/");
  });
}

export async function acknowledgeNewReleaseAction(
  repoId: string,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`acknowledgeNewReleaseAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "ReleaseCard" });
    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex !== -1) {
        currentRepos[repoIndex].isNew = false;
        await saveRepositories(currentRepos);
        revalidatePath("/");
        log.info(`Acknowledged new release for ${repoId}`);
        return { success: true };
      }

      return { success: false, error: t("toast_acknowledge_error_not_found") };
    } catch (error: unknown) {
      log.error("Failed to acknowledge release:", error);
      return { success: false, error: t("toast_acknowledge_error_generic") };
    }
  });
}

export async function markAsNewAction(
  repoId: string,
): Promise<{ success: boolean; error?: string }> {
  return scheduleTask(`markAsNewAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, error: await getRestrictedActionError() };
    }

    if (!isValidRepoId(repoId)) {
      return { success: false, error: "Invalid repository ID format." };
    }
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "ReleaseCard" });
    try {
      const currentRepos = await getRepositories();
      const repoIndex = currentRepos.findIndex((r) => r.id === repoId);

      if (repoIndex !== -1) {
        currentRepos[repoIndex].isNew = true;
        await saveRepositories(currentRepos);
        revalidatePath("/");
        log.info(`Marked release as new for ${repoId}`);
        return { success: true };
      }

      return { success: false, error: t("toast_mark_as_new_error_not_found") };
    } catch (error: unknown) {
      log.error("Failed to mark release as new:", error);
      return { success: false, error: t("toast_mark_as_new_error_generic") };
    }
  });
}

export async function getRepositoriesForExport(): Promise<{
  success: boolean;
  data?: Repository[];
  error?: string;
}> {
  try {
    const repos = await getRepositories();
    return { success: true, data: repos.map(toPublicRepository) };
  } catch (error: unknown) {
    log.error("Failed to get repositories for export:", error);
    return { success: false, error: "Failed to read repository data." };
  }
}

export async function updateRepositorySettingsAction(
  repoId: string,
  settings: Pick<
    Repository,
    | "displayName"
    | "isPinned"
    | "releaseChannels"
    | "preReleaseSubChannels"
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
        });
      const backgroundCheckCronChanged =
        (existing.backgroundCheckCron ?? undefined) !== newBackgroundCheckCron;

      const changes = buildRepositorySettingsChangeLog(
        existing,
        {
          ...settings,
          releaseSelectionStrategy: newReleaseSelectionStrategy,
          versionTagPattern: newVersionTagPattern,
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

export async function revalidateReleasesAction() {
  updateReleaseCacheTags();
}

export async function getJobStatusAction(
  jobId: string,
): Promise<{ status: JobStatus | undefined }> {
  return { status: getJobStatus(jobId) };
}

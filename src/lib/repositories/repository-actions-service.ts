import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { getLatestReleasesForRepos } from "@/lib/releases";
import {
  applyEtagUpdate,
  canReplaceCachedReleaseWithVirtual,
  toCachedRelease,
} from "@/lib/releases/filters";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
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
import { getJobStatus, type JobStatus, setJobStatus } from "@/lib/storage/jobs";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { Repository } from "@/types";

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

    const urlList = urls.split("\n").filter((u) => u.trim() !== "");
    const newRepos: Repository[] = [];
    let failedCount = 0;

    for (const url of urlList) {
      const parsed = parseSupportedRepoUrl(url);
      if (parsed) {
        newRepos.push({
          id: parsed.id,
          url: parsed.canonicalRepoUrl,
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
      const currentRepos = await getRepositories();
      const currentRepoIds = new Set(currentRepos.map((repo) => repo.id));
      const currentReposMap = new Map(currentRepos.map((r) => [r.id, r]));

      const validImportedRepos: Repository[] = [];
      for (const repo of importedData) {
        if (!repo.url) continue;
        const parsed = parseSupportedRepoUrl(repo.url);
        if (!parsed) continue;

        // Normalize id/url on import so GitHub/Codeberg repos remain stable even if
        // the exported data contained variations (trailing paths, `.git`, etc).
        validImportedRepos.push({
          ...repo,
          id: parsed.id,
          url: parsed.canonicalRepoUrl,
        });
      }

      let addedCount = 0;
      let updatedCount = 0;
      const reposToFetch: Repository[] = [];

      for (const importedRepo of validImportedRepos) {
        if (currentRepoIds.has(importedRepo.id)) {
          updatedCount++;
        } else {
          addedCount++;
        }

        const repoToSave: Repository = {
          ...currentReposMap.get(importedRepo.id),
          ...importedRepo,
          isNew:
            (settings.showAcknowledge ?? true)
              ? (importedRepo.isNew ?? false)
              : false,
        };
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
  return scheduleTask(`refreshSingleRepositoryAction: ${repoId}`, async () => {
    if (!(await isRestrictedActionAllowed())) {
      return;
    }

    if (!isValidRepoId(repoId)) {
      log.error("Invalid repoId format for refresh:", repoId);
      return;
    }

    log.info(`Refreshing single repository: ${repoId}`);

    const settings = await getSettings();
    const locale = settings.locale;
    const allRepos = await getRepositories();
    const repoToRefresh = allRepos.find((r) => r.id === repoId);

    if (!repoToRefresh) {
      log.error(`Repository ${repoId} not found for refresh.`);
      return;
    }

    const enrichedReleases = await getLatestReleasesForRepos(
      [repoToRefresh],
      settings,
      locale,
      { skipCache: true },
    );

    const enrichedRelease = enrichedReleases[0];
    if (!enrichedRelease) {
      log.error(`Failed to get release for ${repoId} during single refresh.`);
      return;
    }

    const repoIndex = allRepos.findIndex((r) => r.id === repoId);
    if (repoIndex === -1) return; // Should not happen

    applyEtagUpdate(allRepos[repoIndex], enrichedRelease.newEtag);
    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0;
      const newCached = toCachedRelease(enrichedRelease.release);
      // Avoid overwriting existing real release data with virtual (tag-fallback) data
      if (
        !isVirtual ||
        canReplaceCachedReleaseWithVirtual(allRepos[repoIndex].latestRelease)
      ) {
        allRepos[repoIndex].latestRelease = newCached;
      } else if (
        isVirtual &&
        allRepos[repoIndex].latestRelease &&
        newCached.fetched_at
      ) {
        // Update last successful fetch time on 304 not modified
        allRepos[repoIndex].latestRelease.fetched_at = newCached.fetched_at;
      }
    }

    await saveRepositories(allRepos);
    revalidatePath("/"); // Revalidate the home page to show the new data
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
      const enrichedReleases = await getLatestReleasesForRepos(
        reposToRefresh,
        settings,
        locale,
        { skipCache: true },
      );

      const enrichedMap = new Map(enrichedReleases.map((r) => [r.repoId, r]));

      const updatedRepos = allRepos.map((repo) => {
        const enriched = enrichedMap.get(repo.id);
        if (enriched) {
          if (enriched.release) {
            const isVirtual = enriched.release.id === 0;
            const newCached = toCachedRelease(enriched.release);
            // Avoid overwriting existing real release data with virtual (tag-fallback) data
            if (
              !isVirtual ||
              canReplaceCachedReleaseWithVirtual(repo.latestRelease)
            ) {
              repo.latestRelease = newCached;
            } else if (
              isVirtual &&
              repo.latestRelease &&
              newCached.fetched_at
            ) {
              // Update last successful fetch time on 304 not modified
              repo.latestRelease.fetched_at = newCached.fetched_at;
            }
            // Do not initialize lastSeenReleaseTag from a virtual (tag-fallback) release
            if (!repo.lastSeenReleaseTag && !isVirtual) {
              repo.lastSeenReleaseTag = enriched.release.tag_name;
            }
          }
          applyEtagUpdate(repo, enriched.newEtag);
        }
        return repo;
      });
      await saveRepositories(updatedRepos);
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
    return { success: true, data: repos };
  } catch (error: unknown) {
    log.error("Failed to get repositories for export:", error);
    return { success: false, error: "Failed to read repository data." };
  }
}

export async function updateRepositorySettingsAction(
  repoId: string,
  settings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "releasesPerPage"
    | "refreshInterval"
    | "cacheInterval"
    | "backgroundCheckCron"
    | "includeRegex"
    | "excludeRegex"
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

      const prevInclude = (existing.includeRegex ?? "").trim() || undefined;
      const prevExclude = (existing.excludeRegex ?? "").trim() || undefined;
      const newInclude = (settings.includeRegex ?? "").trim() || undefined;
      const newExclude = (settings.excludeRegex ?? "").trim() || undefined;
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

      const filtersChanged =
        prevInclude !== newInclude || prevExclude !== newExclude;

      // Normalize arrays for comparison (treat empty array as undefined/global)
      const normArray = <T>(arr?: T[] | null) => {
        if (!arr || arr.length === 0) return undefined;
        return [...arr].sort();
      };
      const prevChannels = normArray(existing.releaseChannels);
      const newChannels = normArray(settings.releaseChannels);
      const channelsChanged =
        JSON.stringify(prevChannels) !== JSON.stringify(newChannels);

      const prevPreSubs = normArray(existing.preReleaseSubChannels);
      const newPreSubs = normArray(settings.preReleaseSubChannels);
      const preSubsChanged =
        JSON.stringify(prevPreSubs) !== JSON.stringify(newPreSubs);

      const prevRpp = existing.releasesPerPage ?? undefined;
      const newRpp = settings.releasesPerPage ?? undefined;
      const rppChanged = prevRpp !== newRpp;
      const refreshIntervalChanged =
        (existing.refreshInterval ?? null) !== newRefreshInterval;
      const cacheIntervalChanged =
        (existing.cacheInterval ?? null) !== newCacheInterval;
      const backgroundCheckCronChanged =
        (existing.backgroundCheckCron ?? undefined) !== newBackgroundCheckCron;

      // Build change summary for logging
      const changes: string[] = [];
      const fmt = (value: unknown) =>
        value === undefined ? "undefined" : JSON.stringify(value);
      const cmpArr = (a?: unknown[] | null, b?: unknown[] | null) =>
        JSON.stringify((a || []).slice().sort()) ===
        JSON.stringify((b || []).slice().sort());
      if (!cmpArr(existing.releaseChannels, settings.releaseChannels)) {
        changes.push(
          `releaseChannels: ${fmt(existing.releaseChannels)} -> ${fmt(settings.releaseChannels)}`,
        );
      }
      if (
        !cmpArr(existing.preReleaseSubChannels, settings.preReleaseSubChannels)
      ) {
        changes.push(
          `preReleaseSubChannels: ${fmt(existing.preReleaseSubChannels)} -> ${fmt(settings.preReleaseSubChannels)}`,
        );
      }
      if (
        (existing.releasesPerPage ?? undefined) !==
        (settings.releasesPerPage ?? undefined)
      ) {
        changes.push(
          `releasesPerPage: ${fmt(existing.releasesPerPage)} -> ${fmt(settings.releasesPerPage)}`,
        );
      }
      if (refreshIntervalChanged) {
        changes.push(
          `refreshInterval: ${fmt(existing.refreshInterval)} -> ${fmt(newRefreshInterval)}`,
        );
      }
      if (cacheIntervalChanged) {
        changes.push(
          `cacheInterval: ${fmt(existing.cacheInterval)} -> ${fmt(newCacheInterval)}`,
        );
      }
      if (backgroundCheckCronChanged) {
        changes.push(
          `backgroundCheckCron: ${fmt(existing.backgroundCheckCron)} -> ${fmt(newBackgroundCheckCron)}`,
        );
      }
      if (prevInclude !== newInclude) {
        changes.push(`includeRegex: ${fmt(prevInclude)} -> ${fmt(newInclude)}`);
      }
      if (prevExclude !== newExclude) {
        changes.push(`excludeRegex: ${fmt(prevExclude)} -> ${fmt(newExclude)}`);
      }
      if (
        (existing.appriseTags ?? undefined) !==
        (settings.appriseTags ?? undefined)
      ) {
        changes.push(
          `appriseTags: ${fmt(existing.appriseTags)} -> ${fmt(settings.appriseTags)}`,
        );
      }
      if (
        (existing.appriseFormat ?? undefined) !==
        (settings.appriseFormat ?? undefined)
      ) {
        changes.push(
          `appriseFormat: ${fmt(existing.appriseFormat)} -> ${fmt(settings.appriseFormat)}`,
        );
      }

      const etagInvalidated =
        filtersChanged || channelsChanged || preSubsChanged || rppChanged;

      currentRepos[repoIndex] = {
        ...existing,
        releaseChannels: settings.releaseChannels,
        preReleaseSubChannels: settings.preReleaseSubChannels,
        releasesPerPage: settings.releasesPerPage,
        refreshInterval: newRefreshInterval,
        cacheInterval: newCacheInterval,
        backgroundCheckCron: newBackgroundCheckCron,
        lastBackgroundCheckAt: backgroundCheckCronChanged
          ? undefined
          : existing.lastBackgroundCheckAt,
        includeRegex: newInclude,
        excludeRegex: newExclude,
        appriseTags: settings.appriseTags,
        appriseFormat: settings.appriseFormat,
        // Invalidate ETag when filters/pagination that affect visible latest release change
        etag: etagInvalidated ? undefined : existing.etag,
      };

      await saveRepositories(currentRepos);
      revalidatePath("/");
      if (etagInvalidated) {
        const reasons: string[] = [];
        if (filtersChanged) reasons.push("filtersChanged");
        if (channelsChanged) reasons.push("releaseChannelsChanged");
        if (preSubsChanged) reasons.push("preReleaseSubChannelsChanged");
        if (rppChanged) reasons.push("releasesPerPageChanged");
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

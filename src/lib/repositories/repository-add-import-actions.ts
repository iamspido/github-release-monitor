import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { resolveEffectiveReleaseSelectionStrategy } from "@/lib/releases/selection";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
import { parseImportedRepository } from "@/lib/repositories/repository-import";
import { refreshMultipleRepositoriesAction } from "@/lib/repositories/repository-refresh-actions";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { trackBackgroundTask } from "@/lib/runtime/background-tasks";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
} from "@/lib/server-action-helpers";
import { setJobStatus } from "@/lib/storage/jobs";
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

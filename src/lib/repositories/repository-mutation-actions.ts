import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { toPublicRepository } from "@/lib/repositories/public-repository";
import { isValidRepoId } from "@/lib/repositories/validation";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
  updateReleaseCacheTags,
} from "@/lib/server-action-helpers";
import { getJobStatus, type JobStatus } from "@/lib/storage/jobs";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import type { Repository } from "@/types";

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

export async function revalidateReleasesAction() {
  updateReleaseCacheTags();
}

export async function getJobStatusAction(
  jobId: string,
): Promise<{ status: JobStatus | undefined }> {
  return { status: getJobStatus(jobId) };
}

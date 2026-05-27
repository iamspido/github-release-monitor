"use server";

import {
  getCodebergTokenCheck as getCodebergTokenCheckImpl,
  getGitHubRateLimit as getGitHubRateLimitImpl,
  getGitlabTokenCheck as getGitlabTokenCheckImpl,
} from "@/lib/diagnostics/provider-checks";
import { previewComposeImportAction as previewComposeImportActionImpl } from "@/lib/import/compose-ghcr";
import { getLatestReleasesForRepos as getLatestReleasesForReposImpl } from "@/lib/releases";
import { checkForNewReleases as checkForNewReleasesImpl } from "@/lib/releases/checker";
import { resolveRepoProvidersAction as resolveRepoProvidersActionImpl } from "@/lib/repositories/provider-resolution";
import {
  acknowledgeNewReleaseAction as acknowledgeNewReleaseActionImpl,
  addRepositoriesAction as addRepositoriesActionImpl,
  getJobStatusAction as getJobStatusActionImpl,
  getRepositoriesForExport as getRepositoriesForExportImpl,
  importRepositoriesAction as importRepositoriesActionImpl,
  markAsNewAction as markAsNewActionImpl,
  refreshMultipleRepositoriesAction as refreshMultipleRepositoriesActionImpl,
  refreshSingleRepositoryAction as refreshSingleRepositoryActionImpl,
  removeRepositoryAction as removeRepositoryActionImpl,
  revalidateReleasesAction as revalidateReleasesActionImpl,
  updateRepositorySettingsAction as updateRepositorySettingsActionImpl,
} from "@/lib/repositories/repository-actions-service";
import {
  dismissUpdateNotificationAction as dismissUpdateNotificationActionImpl,
  getUpdateNotificationState as getUpdateNotificationStateImpl,
  triggerAppUpdateCheckAction as triggerAppUpdateCheckActionImpl,
} from "@/lib/runtime/app-update-notice";
import {
  checkAppriseStatusAction as checkAppriseStatusActionImpl,
  refreshAndCheckAction as refreshAndCheckActionImpl,
  refreshDueRepositoriesAction as refreshDueRepositoriesActionImpl,
  sendTestAppriseAction as sendTestAppriseActionImpl,
  sendTestEmailAction as sendTestEmailActionImpl,
  setupTestRepositoryAction as setupTestRepositoryActionImpl,
  triggerReleaseCheckAction as triggerReleaseCheckActionImpl,
} from "@/lib/test-release-actions";

export async function previewComposeImportAction(
  ...args: Parameters<typeof previewComposeImportActionImpl>
) {
  return previewComposeImportActionImpl(...args);
}

export async function resolveRepoProvidersAction(
  ...args: Parameters<typeof resolveRepoProvidersActionImpl>
) {
  return resolveRepoProvidersActionImpl(...args);
}

export async function getLatestReleasesForRepos(
  ...args: Parameters<typeof getLatestReleasesForReposImpl>
) {
  return getLatestReleasesForReposImpl(...args);
}

export async function addRepositoriesAction(
  ...args: Parameters<typeof addRepositoriesActionImpl>
) {
  return addRepositoriesActionImpl(...args);
}

export async function importRepositoriesAction(
  ...args: Parameters<typeof importRepositoriesActionImpl>
) {
  return importRepositoriesActionImpl(...args);
}

export async function refreshSingleRepositoryAction(
  ...args: Parameters<typeof refreshSingleRepositoryActionImpl>
) {
  return refreshSingleRepositoryActionImpl(...args);
}

export async function refreshMultipleRepositoriesAction(
  ...args: Parameters<typeof refreshMultipleRepositoriesActionImpl>
) {
  return refreshMultipleRepositoriesActionImpl(...args);
}

export async function removeRepositoryAction(
  ...args: Parameters<typeof removeRepositoryActionImpl>
) {
  return removeRepositoryActionImpl(...args);
}

export async function acknowledgeNewReleaseAction(
  ...args: Parameters<typeof acknowledgeNewReleaseActionImpl>
) {
  return acknowledgeNewReleaseActionImpl(...args);
}

export async function markAsNewAction(
  ...args: Parameters<typeof markAsNewActionImpl>
) {
  return markAsNewActionImpl(...args);
}

export async function checkForNewReleases(
  ...args: Parameters<typeof checkForNewReleasesImpl>
) {
  return checkForNewReleasesImpl(...args);
}

export async function getUpdateNotificationState(
  ...args: Parameters<typeof getUpdateNotificationStateImpl>
) {
  return getUpdateNotificationStateImpl(...args);
}

export async function dismissUpdateNotificationAction(
  ...args: Parameters<typeof dismissUpdateNotificationActionImpl>
) {
  return dismissUpdateNotificationActionImpl(...args);
}

export async function triggerAppUpdateCheckAction(
  ...args: Parameters<typeof triggerAppUpdateCheckActionImpl>
) {
  return triggerAppUpdateCheckActionImpl(...args);
}

export async function setupTestRepositoryAction(
  ...args: Parameters<typeof setupTestRepositoryActionImpl>
) {
  return setupTestRepositoryActionImpl(...args);
}

export async function triggerReleaseCheckAction(
  ...args: Parameters<typeof triggerReleaseCheckActionImpl>
) {
  return triggerReleaseCheckActionImpl(...args);
}

export async function getGitHubRateLimit(
  ...args: Parameters<typeof getGitHubRateLimitImpl>
) {
  return getGitHubRateLimitImpl(...args);
}

export async function getGitlabTokenCheck(
  ...args: Parameters<typeof getGitlabTokenCheckImpl>
) {
  return getGitlabTokenCheckImpl(...args);
}

export async function getCodebergTokenCheck(
  ...args: Parameters<typeof getCodebergTokenCheckImpl>
) {
  return getCodebergTokenCheckImpl(...args);
}

export async function sendTestEmailAction(
  ...args: Parameters<typeof sendTestEmailActionImpl>
) {
  return sendTestEmailActionImpl(...args);
}

export async function sendTestAppriseAction(
  ...args: Parameters<typeof sendTestAppriseActionImpl>
) {
  return sendTestAppriseActionImpl(...args);
}

export async function checkAppriseStatusAction(
  ...args: Parameters<typeof checkAppriseStatusActionImpl>
) {
  return checkAppriseStatusActionImpl(...args);
}

export async function refreshAndCheckAction(
  ...args: Parameters<typeof refreshAndCheckActionImpl>
) {
  return refreshAndCheckActionImpl(...args);
}

export async function refreshDueRepositoriesAction(
  ...args: Parameters<typeof refreshDueRepositoriesActionImpl>
) {
  return refreshDueRepositoriesActionImpl(...args);
}

export async function getRepositoriesForExport(
  ...args: Parameters<typeof getRepositoriesForExportImpl>
) {
  return getRepositoriesForExportImpl(...args);
}

export async function updateRepositorySettingsAction(
  ...args: Parameters<typeof updateRepositorySettingsActionImpl>
) {
  return updateRepositorySettingsActionImpl(...args);
}

export async function revalidateReleasesAction(
  ...args: Parameters<typeof revalidateReleasesActionImpl>
) {
  return revalidateReleasesActionImpl(...args);
}

export async function getJobStatusAction(
  ...args: Parameters<typeof getJobStatusActionImpl>
) {
  return getJobStatusActionImpl(...args);
}

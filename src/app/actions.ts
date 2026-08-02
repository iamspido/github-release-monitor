"use server";

import {
  getRestrictedActionError,
  runExposedRestrictedActionOrThrow,
  runExposedRestrictedActionWithFallback,
} from "@/lib/auth/exposed-action-policy";
import {
  beginSecretRevealStepUpActionImpl,
  completeSecretRevealStepUpActionImpl,
  getSecretRevealOptionsActionImpl,
  revealAppriseUrlActionImpl,
  revealMailPasswordActionImpl,
  verifySecretRevealTotpActionImpl,
} from "@/lib/diagnostics/notification-config";
import {
  getCodebergTokenCheck as getCodebergTokenCheckImpl,
  getForgejoTokenChecks as getForgejoTokenChecksImpl,
  getGitHubRateLimit as getGitHubRateLimitImpl,
  getGitlabTokenCheck as getGitlabTokenCheckImpl,
} from "@/lib/diagnostics/provider-checks";
import { previewComposeImportAction as previewComposeImportActionImpl } from "@/lib/import/compose-ghcr";
import { getLatestReleasesForRepos as getLatestReleasesForReposImpl } from "@/lib/releases";
import { checkForNewReleases as checkForNewReleasesImpl } from "@/lib/releases/checker";
import {
  resolveRepoProvidersAction as resolveRepoProvidersActionImpl,
  resolveRepoProvidersBatchAction as resolveRepoProvidersBatchActionImpl,
} from "@/lib/repositories/provider-resolution";
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
import type { UpdateNotificationState } from "@/types";

function getEmptyUpdateNotificationState(): UpdateNotificationState {
  return {
    latestVersion: null,
    currentVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    lastCheckedAt: null,
    lastCheckError: null,
    hasUpdate: false,
    isDismissed: false,
    shouldNotify: false,
  };
}

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

export async function resolveRepoProvidersBatchAction(
  ...args: Parameters<typeof resolveRepoProvidersBatchActionImpl>
) {
  return resolveRepoProvidersBatchActionImpl(...args);
}

export async function getLatestReleasesForRepos(
  ...args: Parameters<typeof getLatestReleasesForReposImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getLatestReleasesForReposImpl(...args),
    [],
  );
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
  return runExposedRestrictedActionWithFallback(
    () => refreshMultipleRepositoriesActionImpl(...args),
    undefined,
  );
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
  return runExposedRestrictedActionOrThrow(() =>
    checkForNewReleasesImpl(...args),
  );
}

export async function getUpdateNotificationState(
  ...args: Parameters<typeof getUpdateNotificationStateImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getUpdateNotificationStateImpl(...args),
    getEmptyUpdateNotificationState,
  );
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
  return runExposedRestrictedActionWithFallback(
    () => getGitHubRateLimitImpl(...args),
    {
      data: null,
      error: "api_error" as const,
    },
  );
}

export async function getGitlabTokenCheck(
  ...args: Parameters<typeof getGitlabTokenCheckImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getGitlabTokenCheckImpl(...args),
    {
      status: "api_error" as const,
    },
  );
}

export async function getCodebergTokenCheck(
  ...args: Parameters<typeof getCodebergTokenCheckImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getCodebergTokenCheckImpl(...args),
    {
      status: "api_error" as const,
    },
  );
}

export async function getForgejoTokenChecks(
  ...args: Parameters<typeof getForgejoTokenChecksImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getForgejoTokenChecksImpl(...args),
    [],
  );
}

export async function revealMailPasswordAction(
  ...args: Parameters<typeof revealMailPasswordActionImpl>
) {
  return revealMailPasswordActionImpl(...args);
}

export async function revealAppriseUrlAction(
  ...args: Parameters<typeof revealAppriseUrlActionImpl>
) {
  return revealAppriseUrlActionImpl(...args);
}

export async function getSecretRevealOptionsAction(
  ...args: Parameters<typeof getSecretRevealOptionsActionImpl>
) {
  return getSecretRevealOptionsActionImpl(...args);
}

export async function beginSecretRevealStepUpAction(
  ...args: Parameters<typeof beginSecretRevealStepUpActionImpl>
) {
  return beginSecretRevealStepUpActionImpl(...args);
}

export async function completeSecretRevealStepUpAction(
  ...args: Parameters<typeof completeSecretRevealStepUpActionImpl>
) {
  return completeSecretRevealStepUpActionImpl(...args);
}

export async function verifySecretRevealTotpAction(
  ...args: Parameters<typeof verifySecretRevealTotpActionImpl>
) {
  return verifySecretRevealTotpActionImpl(...args);
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
  return runExposedRestrictedActionWithFallback(
    () => getRepositoriesForExportImpl(...args),
    async () => ({ success: false, error: await getRestrictedActionError() }),
  );
}

export async function updateRepositorySettingsAction(
  ...args: Parameters<typeof updateRepositorySettingsActionImpl>
) {
  return updateRepositorySettingsActionImpl(...args);
}

export async function revalidateReleasesAction(
  ...args: Parameters<typeof revalidateReleasesActionImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => revalidateReleasesActionImpl(...args),
    undefined,
  );
}

export async function getJobStatusAction(
  ...args: Parameters<typeof getJobStatusActionImpl>
) {
  return runExposedRestrictedActionWithFallback(
    () => getJobStatusActionImpl(...args),
    {
      status: undefined,
    },
  );
}

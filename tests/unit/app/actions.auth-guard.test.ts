// vitest globals enabled

import type { AppSettings } from "@/types";

const mocks = vi.hoisted(() => ({
  authAccess: vi.fn(),
  getLatestReleasesForRepos: vi.fn(),
  checkForNewReleases: vi.fn(),
  getGitHubRateLimit: vi.fn(),
  getGitlabTokenCheck: vi.fn(),
  getCodebergTokenCheck: vi.fn(),
  getUpdateNotificationState: vi.fn(),
  refreshMultipleRepositoriesAction: vi.fn(),
  getRepositoriesForExport: vi.fn(),
  revalidateReleasesAction: vi.fn(),
  getJobStatusAction: vi.fn(),
}));

vi.mock("@/lib/auth/access", () => ({
  getCurrentAuthAccess: mocks.authAccess,
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: mocks.getLatestReleasesForRepos,
}));

vi.mock("@/lib/releases/checker", () => ({
  checkForNewReleases: mocks.checkForNewReleases,
}));

vi.mock("@/lib/diagnostics/provider-checks", () => ({
  getGitHubRateLimit: mocks.getGitHubRateLimit,
  getGitlabTokenCheck: mocks.getGitlabTokenCheck,
  getCodebergTokenCheck: mocks.getCodebergTokenCheck,
}));

vi.mock("@/lib/runtime/app-update-notice", () => ({
  getUpdateNotificationState: mocks.getUpdateNotificationState,
  dismissUpdateNotificationAction: vi.fn(),
  triggerAppUpdateCheckAction: vi.fn(),
}));

vi.mock("@/lib/repositories/repository-actions-service", () => ({
  addRepositoriesAction: vi.fn(),
  importRepositoriesAction: vi.fn(),
  refreshSingleRepositoryAction: vi.fn(),
  refreshMultipleRepositoriesAction: mocks.refreshMultipleRepositoriesAction,
  removeRepositoryAction: vi.fn(),
  acknowledgeNewReleaseAction: vi.fn(),
  markAsNewAction: vi.fn(),
  getRepositoriesForExport: mocks.getRepositoriesForExport,
  updateRepositorySettingsAction: vi.fn(),
  revalidateReleasesAction: mocks.revalidateReleasesAction,
  getJobStatusAction: mocks.getJobStatusAction,
}));

vi.mock("@/lib/import/compose-ghcr", () => ({
  previewComposeImportAction: vi.fn(),
}));

vi.mock("@/lib/repositories/provider-resolution", () => ({
  resolveRepoProvidersAction: vi.fn(),
}));

vi.mock("@/lib/test-release-actions", () => ({
  setupTestRepositoryAction: vi.fn(),
  triggerReleaseCheckAction: vi.fn(),
  sendTestEmailAction: vi.fn(),
  sendTestAppriseAction: vi.fn(),
  checkAppriseStatusAction: vi.fn(),
  refreshAndCheckAction: vi.fn(),
  refreshDueRepositoriesAction: vi.fn(),
}));

const settings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
  releaseSortOrder: "latest_first",
  providerSortOrder: ["github", "gitlab", "codeberg"],
  prioritizeNewSecurityReleases: false,
  showAcknowledge: true,
};

describe("app action auth guards", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.authAccess.mockResolvedValue({ canMutate: false });
    mocks.getLatestReleasesForRepos.mockReset();
    mocks.checkForNewReleases.mockReset();
    mocks.getGitHubRateLimit.mockReset();
    mocks.getGitlabTokenCheck.mockReset();
    mocks.getCodebergTokenCheck.mockReset();
    mocks.getUpdateNotificationState.mockReset();
    mocks.refreshMultipleRepositoriesAction.mockReset();
    mocks.getRepositoriesForExport.mockReset();
    mocks.revalidateReleasesAction.mockReset();
    mocks.getJobStatusAction.mockReset();
  });

  it("blocks unauthenticated exposed release and storage helpers", async () => {
    const actions = await import("@/app/actions");

    await expect(
      actions.getLatestReleasesForRepos([], settings, "en"),
    ).resolves.toEqual([]);
    await expect(actions.checkForNewReleases()).rejects.toThrow(
      "error_auth_required",
    );
    await expect(
      actions.refreshMultipleRepositoriesAction(["github:o/r"], "job-1"),
    ).resolves.toBeUndefined();
    await expect(actions.getRepositoriesForExport()).resolves.toEqual({
      success: false,
      error: "error_auth_required",
    });
    await expect(actions.revalidateReleasesAction()).resolves.toBeUndefined();
    await expect(actions.getJobStatusAction("job-1")).resolves.toEqual({
      status: undefined,
    });

    expect(mocks.getLatestReleasesForRepos).not.toHaveBeenCalled();
    expect(mocks.checkForNewReleases).not.toHaveBeenCalled();
    expect(mocks.refreshMultipleRepositoriesAction).not.toHaveBeenCalled();
    expect(mocks.getRepositoriesForExport).not.toHaveBeenCalled();
    expect(mocks.revalidateReleasesAction).not.toHaveBeenCalled();
    expect(mocks.getJobStatusAction).not.toHaveBeenCalled();
  });

  it("does not expose token diagnostics or update status to unauthenticated callers", async () => {
    const actions = await import("@/app/actions");

    await expect(actions.getGitHubRateLimit()).resolves.toEqual({
      data: null,
      error: "api_error",
    });
    await expect(actions.getGitlabTokenCheck()).resolves.toEqual({
      status: "api_error",
    });
    await expect(actions.getCodebergTokenCheck()).resolves.toEqual({
      status: "api_error",
    });
    await expect(actions.getUpdateNotificationState()).resolves.toMatchObject({
      latestVersion: null,
      hasUpdate: false,
      shouldNotify: false,
    });

    expect(mocks.getGitHubRateLimit).not.toHaveBeenCalled();
    expect(mocks.getGitlabTokenCheck).not.toHaveBeenCalled();
    expect(mocks.getCodebergTokenCheck).not.toHaveBeenCalled();
    expect(mocks.getUpdateNotificationState).not.toHaveBeenCalled();
  });
});

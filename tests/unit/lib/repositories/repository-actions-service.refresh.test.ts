import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichedRelease, Repository } from "@/types";

const mocks = vi.hoisted(() => ({
  getLatestReleasesForRepos: vi.fn(),
  getRepositories: vi.fn(),
  getSettings: vi.fn(),
  saveRepositories: vi.fn(),
  setJobStatus: vi.fn(),
  isRestrictedActionAllowed: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: mocks.getLatestReleasesForRepos,
}));
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: mocks.getRepositories,
  saveRepositories: mocks.saveRepositories,
}));
vi.mock("@/lib/storage/settings", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/storage/jobs", () => ({
  getJobStatus: vi.fn(),
  setJobStatus: mocks.setJobStatus,
}));
vi.mock("@/lib/runtime/task-scheduler", () => ({
  scheduleTask: async (_name: string, task: () => Promise<unknown>) => task(),
}));
vi.mock("@/lib/runtime/background-tasks", () => ({
  trackBackgroundTask: vi.fn(),
}));
vi.mock("@/lib/server-action-helpers", () => ({
  getRestrictedActionError: vi.fn(),
  isRestrictedActionAllowed: mocks.isRestrictedActionAllowed,
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  updateReleaseCacheTags: vi.fn(),
}));

describe("repository-actions-service background refresh commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(createSettings());
    mocks.isRestrictedActionAllowed.mockResolvedValue(true);
  });

  it("commits a single refresh into a fresh repository snapshot", async () => {
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
    };
    const currentRepository = {
      ...repository,
      appriseTags: "preserve-this-setting",
    };
    mocks.getRepositories
      .mockResolvedValueOnce(structuredClone([repository]))
      .mockResolvedValueOnce(structuredClone([currentRepository]));
    mocks.getLatestReleasesForRepos.mockResolvedValue([
      releaseResult(repository.id, "v2"),
    ]);
    const { refreshSingleRepositoryAction } = await import(
      "@/lib/repositories/repository-actions-service"
    );

    await refreshSingleRepositoryAction(repository.id);

    expect(mocks.saveRepositories).toHaveBeenCalledWith([
      expect.objectContaining({
        id: repository.id,
        appriseTags: "preserve-this-setting",
        latestRelease: expect.objectContaining({ tag_name: "v2" }),
      }),
    ]);
  });

  it("does not commit a stale single refresh result", async () => {
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
    };
    mocks.getRepositories
      .mockResolvedValueOnce(structuredClone([repository]))
      .mockResolvedValueOnce(
        structuredClone([{ ...repository, includeRegex: "^v2$" }]),
      );
    mocks.getLatestReleasesForRepos.mockResolvedValue([
      releaseResult(repository.id, "v1"),
    ]);
    const { refreshSingleRepositoryAction } = await import(
      "@/lib/repositories/repository-actions-service"
    );

    await refreshSingleRepositoryAction(repository.id);

    expect(mocks.saveRepositories).not.toHaveBeenCalled();
  });

  it("merges fetched release data into a fresh repository snapshot", async () => {
    const staleRepos: Repository[] = [
      { id: "github:deleted/repo", url: "https://github.com/deleted/repo" },
      { id: "github:kept/repo", url: "https://github.com/kept/repo" },
    ];
    const currentRepos: Repository[] = [
      {
        id: "github:kept/repo",
        url: "https://github.com/kept/repo",
        appriseTags: "preserve-this-setting",
      },
    ];
    mocks.getRepositories
      .mockResolvedValueOnce(structuredClone(staleRepos))
      .mockResolvedValueOnce(structuredClone(currentRepos));
    mocks.getLatestReleasesForRepos.mockResolvedValue([
      releaseResult("github:deleted/repo", "v2"),
      releaseResult("github:kept/repo", "v3"),
    ] satisfies EnrichedRelease[]);
    const { refreshMultipleRepositoriesAction } = await import(
      "@/lib/repositories/repository-actions-service"
    );

    await refreshMultipleRepositoriesAction(
      ["github:deleted/repo", "github:kept/repo"],
      "job-1",
    );

    expect(mocks.saveRepositories).toHaveBeenCalledOnce();
    expect(mocks.saveRepositories.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        id: "github:kept/repo",
        appriseTags: "preserve-this-setting",
        lastSeenReleaseTag: "v3",
        latestRelease: expect.objectContaining({ tag_name: "v3" }),
      }),
    ]);
    expect(mocks.setJobStatus).toHaveBeenLastCalledWith("job-1", "complete");
  });

  it("does not apply a result fetched with stale repository filters", async () => {
    const staleRepo: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
    };
    const currentRepo: Repository = {
      ...staleRepo,
      includeRegex: "^v2$",
    };
    mocks.getRepositories
      .mockResolvedValueOnce(structuredClone([staleRepo]))
      .mockResolvedValueOnce(structuredClone([currentRepo]));
    mocks.getLatestReleasesForRepos.mockResolvedValue([
      releaseResult(staleRepo.id, "v1"),
    ]);
    const { refreshMultipleRepositoriesAction } = await import(
      "@/lib/repositories/repository-actions-service"
    );

    await refreshMultipleRepositoriesAction([staleRepo.id], "job-2");

    expect(mocks.saveRepositories).toHaveBeenCalledWith([currentRepo]);
    expect(mocks.setJobStatus).toHaveBeenLastCalledWith("job-2", "complete");
  });

  it("does not apply a result fetched with stale global settings", async () => {
    const repository: Repository = {
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
    };
    mocks.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce(createSettings({ releasesPerPage: 50 }));
    mocks.getRepositories
      .mockResolvedValueOnce(structuredClone([repository]))
      .mockResolvedValueOnce(structuredClone([repository]));
    mocks.getLatestReleasesForRepos.mockResolvedValue([
      releaseResult(repository.id, "v1"),
    ]);
    const { refreshMultipleRepositoriesAction } = await import(
      "@/lib/repositories/repository-actions-service"
    );

    await refreshMultipleRepositoriesAction([repository.id], "job-3");

    expect(mocks.saveRepositories).toHaveBeenCalledWith([repository]);
    expect(mocks.setJobStatus).toHaveBeenLastCalledWith("job-3", "complete");
  });
});

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    parallelRepoFetches: 1,
    releaseChannels: ["stable"],
    ...overrides,
  };
}

function releaseResult(repoId: string, tag: string): EnrichedRelease {
  return {
    repoId,
    repoUrl: `https://github.com/${repoId.slice("github:".length)}`,
    release: {
      id: 1,
      html_url: "https://example.test/release",
      tag_name: tag,
      name: tag,
      body: "body",
      created_at: "2026-01-01T00:00:00.000Z",
      published_at: "2026-01-01T00:00:00.000Z",
      prerelease: false,
      draft: false,
    },
  };
}

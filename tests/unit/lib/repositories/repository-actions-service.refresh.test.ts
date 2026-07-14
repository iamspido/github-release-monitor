import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichedRelease, Repository } from "@/types";

const mocks = vi.hoisted(() => ({
  getLatestReleasesForRepos: vi.fn(),
  getRepositories: vi.fn(),
  saveRepositories: vi.fn(),
  setJobStatus: vi.fn(),
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
  getSettings: async () => ({
    locale: "en",
    releasesPerPage: 30,
    parallelRepoFetches: 1,
    releaseChannels: ["stable"],
  }),
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
  isRestrictedActionAllowed: vi.fn(),
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  updateReleaseCacheTags: vi.fn(),
}));

describe("repository-actions-service background refresh commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        includeRegex: "preserve-this-setting",
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
        includeRegex: "preserve-this-setting",
        lastSeenReleaseTag: "v3",
        latestRelease: expect.objectContaining({ tag_name: "v3" }),
      }),
    ]);
    expect(mocks.setJobStatus).toHaveBeenLastCalledWith("job-1", "complete");
  });
});

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

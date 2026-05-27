import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSettingsForFetch } from "@/lib/releases/types";
import type { AppSettings } from "@/types";

const releaseResult = {
  release: null,
  error: { type: "no_releases_found" as const },
  newEtag: null,
};

const cacheMocks = vi.hoisted(() => ({
  unstableCache: vi.fn(
    (
      fn: (...args: never[]) => unknown,
      _keys: string[],
      _options: { revalidate: number; tags: string[] },
    ) => fn,
  ),
}));

const fetcherMocks = vi.hoisted(() => ({
  github: vi.fn(),
  gitlab: vi.fn(),
  codeberg: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: cacheMocks.unstableCache,
}));

vi.mock("@/lib/releases/github", () => ({
  fetchLatestReleaseFromGitHub: fetcherMocks.github,
}));

vi.mock("@/lib/releases/gitlab", () => ({
  fetchLatestReleaseFromGitLab: fetcherMocks.gitlab,
}));

vi.mock("@/lib/releases/codeberg", () => ({
  fetchLatestReleaseFromCodeberg: fetcherMocks.codeberg,
}));

const globalSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
  preReleaseSubChannels: ["rc"],
};

describe("releases/cache", () => {
  beforeEach(() => {
    vi.resetModules();
    cacheMocks.unstableCache.mockClear();
    fetcherMocks.github.mockResolvedValue(releaseResult);
    fetcherMocks.gitlab.mockResolvedValue(releaseResult);
    fetcherMocks.codeberg.mockResolvedValue(releaseResult);
  });

  it("bypasses Next cache when requested", async () => {
    const { fetchLatestReleaseWithCache } = await import(
      "@/lib/releases/cache"
    );
    const repoSettings: RepoSettingsForFetch = {
      cacheInterval: 10,
      releasesPerPage: 25,
    };

    await expect(
      fetchLatestReleaseWithCache(
        "codeberg",
        undefined,
        "forgejo",
        "forgejo",
        repoSettings,
        globalSettings,
        "en",
        { skipCache: true },
      ),
    ).resolves.toBe(releaseResult);

    expect(cacheMocks.unstableCache).not.toHaveBeenCalled();
    expect(fetcherMocks.codeberg).toHaveBeenCalledWith(
      "forgejo",
      "forgejo",
      repoSettings,
      globalSettings,
      "en",
    );
  });

  it("bypasses Next cache when the effective cache interval is disabled", async () => {
    const { fetchLatestReleaseWithCache } = await import(
      "@/lib/releases/cache"
    );
    const repoSettings: RepoSettingsForFetch = {
      cacheInterval: 0,
    };

    await fetchLatestReleaseWithCache(
      "github",
      undefined,
      "owner",
      "repo",
      repoSettings,
      globalSettings,
      "de",
    );

    expect(cacheMocks.unstableCache).not.toHaveBeenCalled();
    expect(fetcherMocks.github).toHaveBeenCalledWith(
      "owner",
      "repo",
      repoSettings,
      globalSettings,
      "de",
    );
  });

  it("keys and tags cached GitLab fetches by host and cache interval", async () => {
    const { fetchLatestReleaseWithCache } = await import(
      "@/lib/releases/cache"
    );
    const repoSettings: RepoSettingsForFetch = {
      cacheInterval: 3,
      releasesPerPage: 42,
    };

    await fetchLatestReleaseWithCache(
      "gitlab",
      "gitlab.example.test",
      "group",
      "project",
      repoSettings,
      globalSettings,
      "en",
    );

    expect(cacheMocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      [
        "gitlab-release-gitlab.example.test",
        "gitlab",
        "gitlab.example.test",
        "group",
        "project",
        "en",
        JSON.stringify(repoSettings),
        "42",
        "3",
      ],
      {
        revalidate: 180,
        tags: ["gitlab-releases"],
      },
    );
    expect(fetcherMocks.gitlab).toHaveBeenCalledWith(
      "gitlab.example.test",
      "group",
      "project",
      repoSettings,
      globalSettings,
      "en",
    );
  });

  it("uses gitlab.com as the default GitLab host inside cached fetches", async () => {
    const { fetchLatestReleaseWithCache } = await import(
      "@/lib/releases/cache"
    );
    const repoSettings: RepoSettingsForFetch = {
      cacheInterval: 1,
      releasesPerPage: 2_000,
    };

    await fetchLatestReleaseWithCache(
      "gitlab",
      undefined,
      "group",
      "project",
      repoSettings,
      globalSettings,
      "en",
    );

    expect(cacheMocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      expect.arrayContaining(["gitlab-release-gitlab.com", "30", "1"]),
      expect.objectContaining({
        revalidate: 60,
        tags: ["gitlab-releases"],
      }),
    );
    expect(fetcherMocks.gitlab).toHaveBeenCalledWith(
      "gitlab.com",
      "group",
      "project",
      repoSettings,
      globalSettings,
      "en",
    );
  });
});

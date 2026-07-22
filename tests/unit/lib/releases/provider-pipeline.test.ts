import type { EffectiveRepoFilters } from "@/lib/releases/filters";
import {
  applyCommitMetadata,
  buildFallbackMarkdown,
  notModifiedResult,
  releaseErrorResult,
  releaseSuccessResult,
  resolvePageCount,
  resolvePageSize,
  resolveReleaseSelectionErrorType,
  selectLatestMatchingRelease,
} from "@/lib/releases/provider-pipeline";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import type { GithubRelease } from "@/types";

const stableOnlyFilters: EffectiveRepoFilters = {
  effectiveReleaseChannels: ["stable"],
  effectivePreReleaseSubChannels: [],
  effectiveReleaseSelectionStrategy: "newest",
  versionTagPattern: undefined,
  totalReleasesToFetch: 30,
  effectiveIncludeRegex: undefined,
  effectiveExcludeRegex: undefined,
};

function release(
  tagName: string,
  publishedAt: string,
  overrides: Partial<GithubRelease> = {},
): GithubRelease {
  return {
    id: Number(publishedAt.replace(/\D/g, "").slice(-6)) || 1,
    html_url: `https://example.test/releases/${tagName}`,
    tag_name: tagName,
    name: tagName,
    body: null,
    created_at: publishedAt,
    published_at: publishedAt,
    prerelease: false,
    draft: false,
    ...overrides,
  };
}

describe("releases/provider-pipeline", () => {
  it("calculates page counts and capped page sizes", () => {
    expect(resolvePageCount(101, 50)).toBe(3);
    expect(
      resolvePageSize({
        maxPerPage: 50,
        totalItemsToFetch: 101,
        alreadyFetched: 100,
      }),
    ).toBe(1);
  });

  it("returns a consistent not-modified fetch result", () => {
    expect(notModifiedResult("github:owner/repo", '"etag-1"')).toEqual({
      release: null,
      error: { type: "not_modified" },
      newEtag: '"etag-1"',
    });
  });

  it("builds consistent provider results and fallback metadata", () => {
    const candidate = release("v1.0.0", "2024-01-01T00:00:00Z", {
      body: "",
      published_at_unknown: true,
    });

    applyCommitMetadata(
      candidate,
      { message: "Fix issue", date: "2024-01-02T00:00:00Z" },
      "Commit message",
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        body: buildFallbackMarkdown("Commit message", "Fix issue"),
        created_at: "2024-01-02T00:00:00Z",
        published_at: "2024-01-02T00:00:00Z",
        published_at_unknown: false,
      }),
    );
    expect(
      releaseSuccessResult(candidate, '"etag-2"', "2024-01-03T00:00:00Z"),
    ).toEqual({ release: candidate, error: null, newEtag: '"etag-2"' });
    expect(candidate.fetched_at).toBe("2024-01-03T00:00:00Z");
    expect(releaseErrorResult("no_matching_releases", '"etag-2"')).toEqual({
      release: null,
      error: { type: "no_matching_releases" },
      newEtag: '"etag-2"',
    });
  });

  it("selects the newest matching release without mutating input order", () => {
    const older = release("v1.0.0", "2024-01-01T00:00:00Z");
    const newer = release("v1.1.0", "2024-03-01T00:00:00Z");
    const ignored = release("v2.0.0-beta.1", "2024-04-01T00:00:00Z", {
      prerelease: true,
    });
    const releases = [older, newer, ignored];

    expect(
      selectLatestMatchingRelease({
        releases,
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
      }),
    ).toBe(newer);
    expect(releases).toEqual([older, newer, ignored]);
  });

  it("selects the highest semantic version independently of publication date", () => {
    const mostRecentlyPublished = release(
      "v2.9.0",
      "2024-04-01T00:00:00Z",
    );
    const highestVersion = release("v2.10.0", "2024-01-01T00:00:00Z");
    const prerelease = release("v3.0.0-rc.1", "2024-05-01T00:00:00Z", {
      prerelease: true,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [mostRecentlyPublished, highestVersion, prerelease],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(highestVersion);
  });

  it("does not treat unknown semantic prerelease identifiers as stable", () => {
    const stable = release("v2.0.0", "2024-01-01T00:00:00Z");
    const experimental = release(
      "v3.0.0-experimental.1",
      "2024-02-01T00:00:00Z",
    );

    expect(
      selectLatestMatchingRelease({
        releases: [experimental, stable],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(stable);

    expect(
      selectLatestMatchingRelease({
        releases: [experimental, stable],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
        },
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(experimental);
  });

  it("supports abbreviated versions and SemVer prerelease precedence", () => {
    const v2 = release("v2", "2024-01-01T00:00:00Z", {
      prerelease: true,
    });
    const rc2 = release("v3.0.0-rc.2", "2024-03-01T00:00:00Z", {
      prerelease: true,
    });
    const rc10 = release("v3.0.0-rc.10", "2024-02-01T00:00:00Z", {
      prerelease: true,
    });
    const prereleaseFilters: EffectiveRepoFilters = {
      ...stableOnlyFilters,
      effectiveReleaseChannels: ["prerelease"],
      effectivePreReleaseSubChannels: ["rc"],
    };

    expect(
      selectLatestMatchingRelease({
        releases: [v2, rc2, rc10],
        filters: prereleaseFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(rc10);
  });

  it("uses deterministic ASCII ordering for SemVer prerelease identifiers", () => {
    const uppercase = release(
      "v1.0.0-alpha.B",
      "2024-02-01T00:00:00Z",
      { prerelease: true },
    );
    const lowercase = release(
      "v1.0.0-alpha.a",
      "2024-01-01T00:00:00Z",
      { prerelease: true },
    );
    const prereleaseFilters: EffectiveRepoFilters = {
      ...stableOnlyFilters,
      effectiveReleaseChannels: ["prerelease"],
      effectivePreReleaseSubChannels: ["alpha"],
    };

    expect(
      selectLatestMatchingRelease({
        releases: [uppercase, lowercase],
        filters: prereleaseFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(lowercase);
  });

  it("ignores non-version tags when comparable versions exist", () => {
    const nightly = release("nightly", "2024-04-01T00:00:00Z");
    const version = release("1.2.3+build.7", "2024-01-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [nightly, version],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(version);
  });

  it("falls back to publication date when no tag is version-like", () => {
    const older = release("autumn", "2024-01-01T00:00:00Z");
    const newer = release("winter", "2024-04-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [older, newer],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(newer);
  });

  it("selects a Coturn Docker revision through a repository version pattern", () => {
    const sourceRelease = release("4.15.0", "2026-07-01T00:00:00Z");
    const dockerRelease = release(
      "docker/4.15.0-r0",
      "2026-06-01T00:00:00Z",
    );
    const pattern =
      "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [sourceRelease, dockerRelease],
        filters: { ...stableOnlyFilters, versionTagPattern: pattern },
        repoIdForLog: "coturn/coturn",
        strategy: "highest_version",
      }),
    ).toBe(dockerRelease);
  });

  it("compares numeric revisions and four-part extracted versions", () => {
    const olderRevision = release(
      "docker/4.15.0.1-r2",
      "2026-07-03T00:00:00Z",
    );
    const newerRevision = release(
      "docker/4.15.0.1-r10",
      "2026-07-01T00:00:00Z",
    );
    const olderVersion = release(
      "docker/4.15.0.0-r99",
      "2026-07-04T00:00:00Z",
    );
    const pattern =
      "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [olderRevision, newerRevision, olderVersion],
        filters: { ...stableOnlyFilters, versionTagPattern: pattern },
        repoIdForLog: "coturn/coturn",
        strategy: "highest_version",
      }),
    ).toBe(newerRevision);
  });

  it("applies prerelease filtering to the version extracted from a tag path", () => {
    const stable = release("docker/4.15.0-r0", "2026-07-01T00:00:00Z");
    const experimental = release(
      "docker/5.0.0-experimental.1-r0",
      "2026-07-02T00:00:00Z",
    );
    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [experimental, stable],
        filters: { ...stableOnlyFilters, versionTagPattern: pattern },
        repoIdForLog: "coturn/coturn",
        strategy: "highest_version",
      }),
    ).toBe(stable);
  });

  it("does not interpret words in a matched tag path as prerelease channels", () => {
    const stable = release(
      "beta/docker/4.15.0-r0",
      "2026-07-01T00:00:00Z",
    );
    const pattern =
      "^beta/docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [stable],
        filters: { ...stableOnlyFilters, versionTagPattern: pattern },
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(stable);
  });

  it("ignores a stored version tag pattern for other selection strategies", () => {
    const releaseWithPrereleaseLikeVersion = release(
      "docker/5.0.0-experimental.1-r0",
      "2026-07-01T00:00:00Z",
    );
    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [releaseWithPrereleaseLikeVersion],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseSelectionStrategy: "newest",
          versionTagPattern: pattern,
        },
        repoIdForLog: "repo",
        strategy: "newest",
      }),
    ).toBe(releaseWithPrereleaseLikeVersion);
  });

  it("does not fall back to publication time when a version pattern is configured", () => {
    const unrelated = release("4.15.0", "2026-07-01T00:00:00Z");
    const pattern = "^docker/(?<version>\\d+\\.\\d+\\.\\d+)$";
    const filters = { ...stableOnlyFilters, versionTagPattern: pattern };

    expect(
      selectLatestMatchingRelease({
        releases: [unrelated],
        filters,
        repoIdForLog: "coturn/coturn",
        strategy: "highest_version",
      }),
    ).toBeNull();
    expect(
      resolveReleaseSelectionErrorType({
        releases: [unrelated],
        filters,
        strategy: "highest_version",
      }),
    ).toBe("no_matching_version_tags");
  });

  it("validates the required named version group", () => {
    expect(validateVersionTagPattern("[")).toBe("invalid");
    expect(validateVersionTagPattern("^(\\d+\\.\\d+\\.\\d+)$")).toBe(
      "missing_version_group",
    );
    expect(
      validateVersionTagPattern(
        "^docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$",
      ),
    ).toBeNull();
  });

  it("uses only the provider-designated latest release when it matches filters", () => {
    const newestByDate = release("v2.0.0", "2024-04-01T00:00:00Z");
    const providerLatest = release("v1.5.0", "2024-01-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [newestByDate],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "provider_latest",
        providerLatestRelease: providerLatest,
      }),
    ).toBe(providerLatest);
    expect(
      selectLatestMatchingRelease({
        releases: [newestByDate],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "provider_latest",
        providerLatestRelease: release(
          "v3.0.0-beta.1",
          "2024-05-01T00:00:00Z",
          { prerelease: true },
        ),
      }),
    ).toBeNull();
  });
});

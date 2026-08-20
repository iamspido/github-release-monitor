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
  effectiveCustomPreReleaseMarkers: [],
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

  it("does not select an unknown placeholder over a known newest date", () => {
    const unknown = release("v1.1.0", "2026-07-26T00:00:00Z", {
      published_at_unknown: true,
    });
    const known = release("v1.0.0", "2024-03-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [unknown, known],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
      }),
    ).toBe(known);
  });

  it("selects the highest semantic version independently of publication date", () => {
    const mostRecentlyPublished = release("v2.9.0", "2024-04-01T00:00:00Z");
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

  it("selects prefixed abbreviated versions independently of publication date", () => {
    const mostRecentlyPublished = release("release-v1", "2026-07-01T00:00:00Z");
    const highestVersion = release("release-v2", "2026-06-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [mostRecentlyPublished, highestVersion],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "highest_version",
      }),
    ).toBe(highestVersion);
  });

  it("treats unrecognized version suffixes as stable", () => {
    const stableSuffixes = [
      release("34.0.3-ls446", "2026-08-13T12:31:54Z"),
      release("v1.0.0-fix", "2026-01-26T06:49:56Z"),
      release("v1.7.0-spt-4.0", "2026-04-01T18:04:35Z"),
      release("product-3.0.0-experimental.1", "2026-02-01T00:00:00Z"),
    ];

    for (const candidate of stableSuffixes) {
      expect(
        selectLatestMatchingRelease({
          releases: [candidate],
          filters: stableOnlyFilters,
          repoIdForLog: "repo",
          strategy: "newest",
        }),
      ).toBe(candidate);

      expect(
        selectLatestMatchingRelease({
          releases: [candidate],
          filters: {
            ...stableOnlyFilters,
            effectiveReleaseChannels: ["prerelease"],
          },
          repoIdForLog: "repo",
          strategy: "newest",
        }),
      ).toBeNull();
    }
  });

  it("selects a stable revision suffix over newer provider prereleases", () => {
    const previous = release("previous-33.0.8-ls112", "2026-08-18T12:21:21Z", {
      prerelease: true,
    });
    const develop = release(
      "develop-35.0.0beta3-ls198",
      "2026-08-18T15:25:29Z",
      { prerelease: true },
    );
    const production = release("34.0.3-ls446", "2026-08-13T12:31:54Z");

    expect(
      selectLatestMatchingRelease({
        releases: [previous, develop, production],
        filters: stableOnlyFilters,
        repoIdForLog: "linuxserver/docker-nextcloud",
        strategy: "newest",
      }),
    ).toBe(production);
  });

  it("continues to classify known markers as prereleases", () => {
    const releaseCandidate = release("v3.0.0-rc.1", "2026-02-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [releaseCandidate],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "newest",
      }),
    ).toBeNull();

    expect(
      selectLatestMatchingRelease({
        releases: [releaseCandidate],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectivePreReleaseSubChannels: ["rc"],
        },
        repoIdForLog: "repo",
        strategy: "newest",
      }),
    ).toBe(releaseCandidate);
  });

  it("treats short letter revisions as stable unless configured otherwise", () => {
    const julyRevisionA = release("2026-07a", "2026-07-01T00:00:00Z");
    const julyRevisionB = release("2026-07b", "2026-07-02T00:00:00Z");
    const septemberRevision = release("2026-09z", "2026-09-01T00:00:00Z");
    const octoberRevision = release("2026-10a", "2026-10-01T00:00:00Z");
    const providerPrerelease = release("2026-11b", "2026-11-01T00:00:00Z", {
      prerelease: true,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [julyRevisionA, julyRevisionB],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(julyRevisionB);
    expect(
      selectLatestMatchingRelease({
        releases: [octoberRevision, septemberRevision],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(octoberRevision);
    expect(
      selectLatestMatchingRelease({
        releases: [julyRevisionB],
        filters: {
          ...stableOnlyFilters,
          effectiveCustomPreReleaseMarkers: ["b"],
        },
        repoIdForLog: "owner/repo",
        strategy: "newest",
      }),
    ).toBeNull();
    expect(
      selectLatestMatchingRelease({
        releases: [julyRevisionB],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectiveCustomPreReleaseMarkers: ["b"],
        },
        repoIdForLog: "owner/repo",
        strategy: "newest",
      }),
    ).toBe(julyRevisionB);
    expect(
      selectLatestMatchingRelease({
        releases: [providerPrerelease],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "newest",
      }),
    ).toBeNull();
    expect(
      selectLatestMatchingRelease({
        releases: [providerPrerelease],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
        },
        repoIdForLog: "owner/repo",
        strategy: "newest",
      }),
    ).toBe(providerPrerelease);
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
    const uppercase = release("v1.0.0-alpha.B", "2024-02-01T00:00:00Z", {
      prerelease: true,
    });
    const lowercase = release("v1.0.0-alpha.a", "2024-01-01T00:00:00Z", {
      prerelease: true,
    });
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

  it("recognizes prefixed versions without treating dated tags as versions", () => {
    const datedTag = release("weekly.2012-03-27", "2026-07-03T00:00:00Z");
    const mixedSeparatorDate = release(
      "weekly.2012-03.27",
      "2026-07-05T00:00:00Z",
    );
    const dottedCalendarDate = release(
      "weekly-2012.03.27",
      "2026-07-07T00:00:00Z",
    );
    const compactCalendarDate = release(
      "nightly2026.07.26",
      "2026-07-08T00:00:00Z",
    );
    const pathCalendarDate = release(
      "build/2026.07.26",
      "2026-07-09T00:00:00Z",
    );
    const tooManyComponents = release("9.8.7.6.5", "2026-07-06T00:00:00Z");
    const olderStable = release("runtime1.25.10", "2026-07-02T00:00:00Z");
    const latestStable = release("runtime1.26.5", "2026-07-01T00:00:00Z");
    const legacyVersionFamily = release(
      "release.r60.3",
      "2011-10-18T00:00:00Z",
    );
    const releaseCandidate = release(
      "release_candidate_1.27rc2",
      "2026-07-04T00:00:00Z",
    );

    expect(
      selectLatestMatchingRelease({
        releases: [
          datedTag,
          mixedSeparatorDate,
          dottedCalendarDate,
          compactCalendarDate,
          pathCalendarDate,
          tooManyComponents,
          olderStable,
          latestStable,
          legacyVersionFamily,
          releaseCandidate,
        ],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(latestStable);
  });

  it("selects the highest prefixed calendar version", () => {
    const mostRecentlyPublished = release(
      "release-2026.07.25",
      "2026-07-26T00:00:00Z",
    );
    const highestVersion = release(
      "release-2026.07.26",
      "2026-07-25T00:00:00Z",
    );

    expect(
      selectLatestMatchingRelease({
        releases: [mostRecentlyPublished, highestVersion],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(highestVersion);
  });

  it("selects the highest version from the most recently active tag family", () => {
    const legacy = release("legacy60.3", "2020-01-01T00:00:00Z");
    const currentOlder = release("product3-1.25.10", "2026-07-02T00:00:00Z");
    const currentLatest = release("product3-1.26.5", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [legacy, currentOlder, currentLatest],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(currentLatest);
  });

  it("does not let unknown tag timestamps override a known active family", () => {
    const current = release("product-1.26.5", "2026-07-07T00:00:00Z");
    const legacyWithPlaceholderDate = release(
      "legacy60.3",
      "2026-07-26T00:00:00Z",
      { published_at_unknown: true },
    );

    expect(
      selectLatestMatchingRelease({
        releases: [legacyWithPlaceholderDate, current],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(current);
  });

  it("uses the most represented family when tag timestamps are placeholders", () => {
    const timestamp = "2026-07-01T00:00:00Z";
    const legacy = release("legacy60.3", timestamp);
    const currentOlder = release("product3-1.25.10", timestamp);
    const currentLatest = release("product3-1.26.5", timestamp);

    expect(
      selectLatestMatchingRelease({
        releases: [legacy, currentOlder, currentLatest],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(currentLatest);
  });

  it("breaks an active-family date tie independently of provider order", () => {
    const activeTime = "2026-07-01T00:00:00Z";
    const olderTime = "2020-01-01T00:00:00Z";
    const engine = release("engine-2.0.0", activeTime);
    const runtimeOlder = release("runtime-8.0.0", activeTime);
    const runtimeLatest = release("runtime-9.0.0", activeTime);
    const legacy = release("legacy-99.0.0", olderTime);

    const select = (releases: GithubRelease[]) =>
      selectLatestMatchingRelease({
        releases,
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      });

    expect(select([engine, runtimeOlder, runtimeLatest, legacy])).toBe(
      runtimeLatest,
    );
    expect(select([legacy, runtimeLatest, runtimeOlder, engine])).toBe(
      runtimeLatest,
    );
  });

  it("returns no match when version families remain tied", () => {
    const timestamp = "2026-07-01T00:00:00Z";
    const engine = release("engine-2.0.0", timestamp);
    const runtime = release("runtime-9.0.0", timestamp);

    const select = (releases: GithubRelease[]) =>
      selectLatestMatchingRelease({
        releases,
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      });

    expect(select([engine, runtime])).toBeNull();
    expect(select([runtime, engine])).toBeNull();
  });

  it("compares stable package revisions numerically without changing channels", () => {
    const r2 = release("docker/5.0.0-r2", "2026-07-02T00:00:00Z");
    const r10 = release("docker/5.0.0-r10", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [r2, r10],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(r10);

    expect(
      selectLatestMatchingRelease({
        releases: [r10],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "newest",
      }),
    ).toBe(r10);
  });

  it("orders production suffixes above the base version and compares embedded numbers naturally", () => {
    const base = release("v1.0.0", "2026-07-03T00:00:00Z");
    const fix = release("v1.0.0-fix", "2026-07-01T00:00:00Z");
    const ls99 = release("v2.0.0-ls99", "2026-07-03T00:00:00Z");
    const ls100 = release("v2.0.0-ls100", "2026-07-01T00:00:00Z");
    const releaseCandidate = release("v1.0.0-rc.1", "2026-07-04T00:00:00Z", {
      prerelease: true,
    });

    const select = (releases: GithubRelease[]) =>
      selectLatestMatchingRelease({
        releases,
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      });

    expect(select([fix, base])).toBe(fix);
    expect(select([ls100, ls99])).toBe(ls100);
    expect(
      selectLatestMatchingRelease({
        releases: [releaseCandidate, base],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["stable", "prerelease"],
          effectivePreReleaseSubChannels: ["rc"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(base);
  });

  it("compares custom compact prereleases with tag prefixes", () => {
    const b2 = release("runtime1.27b2", "2026-07-02T00:00:00Z");
    const b10 = release("runtime-1.27b10", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [b2, b10],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectiveCustomPreReleaseMarkers: ["b"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(b10);
  });

  it("compares hyphenated custom marker revisions numerically", () => {
    const testing9 = release("v1.0.0-testing9", "2026-07-02T00:00:00Z");
    const testing10 = release("v1.0.0-testing10", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [testing9, testing10],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectiveCustomPreReleaseMarkers: ["testing"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(testing10);
  });

  it("compares custom marker revisions after a qualifier numerically", () => {
    const testing9 = release("v1.0.0-linux-testing9", "2026-07-02T00:00:00Z");
    const testing10 = release("v1.0.0-linux-testing10", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [testing9, testing10],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectiveCustomPreReleaseMarkers: ["testing"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(testing10);
  });

  it("keeps custom r revisions below the corresponding stable version", () => {
    const stable = release("v1.0.0", "2026-07-01T00:00:00Z");
    const customR = release("v1.0.0-r10", "2026-07-02T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [customR, stable],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["stable", "prerelease"],
          effectiveCustomPreReleaseMarkers: ["r"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(stable);
  });

  it("compares hyphenated Unicode marker revisions numerically", () => {
    const testing9 = release("v1.0.0-测试9", "2026-07-02T00:00:00Z");
    const testing10 = release("v1.0.0-测试10", "2026-07-01T00:00:00Z");

    expect(
      selectLatestMatchingRelease({
        releases: [testing9, testing10],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseChannels: ["prerelease"],
          effectiveCustomPreReleaseMarkers: ["测试"],
        },
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(testing10);
  });

  it("recognizes custom compact versions when classifying selection errors", () => {
    const customCompact = release("runtime1.27b10", "2026-07-01T00:00:00Z");

    expect(
      resolveReleaseSelectionErrorType({
        releases: [customCompact],
        filters: {
          ...stableOnlyFilters,
          effectiveCustomPreReleaseMarkers: ["b"],
          effectiveReleaseSelectionStrategy: "highest_version",
          versionTagPattern: "^(?<version>runtime\\d+\\.\\d+b\\d+)$",
        },
        strategy: "highest_version",
      }),
    ).toBe("no_matching_releases");
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

  it("does not use provider order when non-version tag dates are unknown", () => {
    const firstApiTag = release("weekly.2012-03-27", "2026-07-26T00:00:00Z", {
      published_at_unknown: true,
    });
    const secondApiTag = release("nightly-main", "2026-07-26T00:00:00Z", {
      published_at_unknown: true,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [firstApiTag, secondApiTag],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBeNull();
  });

  it("uses a known publication date instead of an unknown placeholder", () => {
    const known = release("autumn", "2024-01-01T00:00:00Z");
    const unknown = release("winter", "2026-07-26T00:00:00Z", {
      published_at_unknown: true,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [unknown, known],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(known);
  });

  it("does not use an unknown timestamp to break an equal-version tie", () => {
    const known = release("v1.0.0", "2024-01-01T00:00:00Z");
    const unknown = release("1.0.0", "2026-07-26T00:00:00Z", {
      published_at_unknown: true,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [unknown, known],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBe(known);
  });

  it("does not fall back to a malformed publication date", () => {
    const malformed = release("autumn", "not-a-date");

    expect(
      selectLatestMatchingRelease({
        releases: [malformed],
        filters: stableOnlyFilters,
        repoIdForLog: "owner/repo",
        strategy: "highest_version",
      }),
    ).toBeNull();
  });

  it("selects a Coturn Docker revision through a repository version pattern", () => {
    const sourceRelease = release("4.15.0", "2026-07-01T00:00:00Z");
    const dockerRelease = release("docker/4.15.0-r0", "2026-06-01T00:00:00Z");
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
    const olderRevision = release("docker/4.15.0.1-r2", "2026-07-03T00:00:00Z");
    const newerRevision = release(
      "docker/4.15.0.1-r10",
      "2026-07-01T00:00:00Z",
    );
    const olderVersion = release("docker/4.15.0.0-r99", "2026-07-04T00:00:00Z");
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
    const releaseCandidate = release(
      "docker/5.0.0-rc.1-r0",
      "2026-07-02T00:00:00Z",
    );
    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [releaseCandidate, stable],
        filters: { ...stableOnlyFilters, versionTagPattern: pattern },
        repoIdForLog: "coturn/coturn",
        strategy: "highest_version",
      }),
    ).toBe(stable);
  });

  it("does not interpret words in a matched tag path as prerelease channels", () => {
    const stable = release("beta/docker/4.15.0-r0", "2026-07-01T00:00:00Z");
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
    const stable = release("docker/5.0.0", "2026-07-01T00:00:00Z");
    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)-r(?<revision>\\d+)$";

    expect(
      selectLatestMatchingRelease({
        releases: [stable],
        filters: {
          ...stableOnlyFilters,
          effectiveReleaseSelectionStrategy: "newest",
          versionTagPattern: pattern,
        },
        repoIdForLog: "repo",
        strategy: "newest",
      }),
    ).toBe(stable);
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

  it("can treat an authoritative provider-latest release as stable", () => {
    const providerLatest = release("v1.5.0-beta.1", "2024-05-01T00:00:00Z", {
      prerelease: false,
    });

    expect(
      selectLatestMatchingRelease({
        releases: [],
        filters: stableOnlyFilters,
        repoIdForLog: "repo",
        strategy: "provider_latest",
        providerLatestRelease: providerLatest,
        providerLatestIsStable: true,
      }),
    ).toBe(providerLatest);
  });
});

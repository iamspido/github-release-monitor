import type { EffectiveRepoFilters } from "@/lib/releases/filters";
import {
  notModifiedResult,
  resolvePageCount,
  resolvePageSize,
  selectFirstMatchingRelease,
  selectLatestMatchingRelease,
} from "@/lib/releases/provider-pipeline";
import type { GithubRelease } from "@/types";

const stableOnlyFilters: EffectiveRepoFilters = {
  effectiveReleaseChannels: ["stable"],
  effectivePreReleaseSubChannels: [],
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

  it("selects the first candidate matching the effective filters", () => {
    const prerelease = release("v2.0.0-beta.1", "2024-02-01T00:00:00Z", {
      prerelease: true,
    });
    const stable = release("v1.0.0", "2024-01-01T00:00:00Z");

    expect(
      selectFirstMatchingRelease(
        [{ release: prerelease }, { release: stable }],
        stableOnlyFilters,
        "repo",
      ),
    ).toEqual({ release: stable });
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
});

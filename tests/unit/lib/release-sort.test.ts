import { describe, expect, it } from "vitest";
import { sortEnrichedReleases } from "@/lib/release-sort";
import type { EnrichedRelease } from "@/types";

function release(
  repoId: string,
  date: string | null,
  isNew = false,
  body: string | null = null,
): EnrichedRelease {
  return {
    repoId,
    repoUrl: `https://example.com/${repoId}`,
    isNew,
    release: date
      ? ({
          id: 1,
          html_url: `https://example.com/${repoId}/releases/v1`,
          tag_name: "v1",
          name: "v1",
          body,
          created_at: date,
          published_at: date,
          prerelease: false,
          draft: false,
        } as EnrichedRelease["release"])
      : undefined,
  };
}

function ids(releases: EnrichedRelease[]) {
  return releases.map((item) => item.repoId);
}

describe("sortEnrichedReleases", () => {
  const releases = [
    release("github:owner/old", "2024-01-01T00:00:00.000Z"),
    release("gitlab:gitlab.com/owner/new", "2024-03-01T00:00:00.000Z"),
    release("codeberg:owner/mid", "2024-02-01T00:00:00.000Z"),
    release("unknown:owner/no-release", null),
  ];

  it("sorts latest releases first by default and keeps missing releases last", () => {
    expect(
      ids(sortEnrichedReleases(releases, "latest_first", undefined)),
    ).toEqual([
      "gitlab:gitlab.com/owner/new",
      "codeberg:owner/mid",
      "github:owner/old",
      "unknown:owner/no-release",
    ]);
  });

  it("sorts new releases first and then by latest release", () => {
    const input = [
      release("github:owner/seen-newer", "2024-03-01T00:00:00.000Z"),
      release("github:owner/new-older", "2024-01-01T00:00:00.000Z", true),
      release("github:owner/new-newer", "2024-02-01T00:00:00.000Z", true),
    ];

    expect(ids(sortEnrichedReleases(input, "new_first", undefined))).toEqual([
      "github:owner/new-newer",
      "github:owner/new-older",
      "github:owner/seen-newer",
    ]);
  });

  it("can prioritize new security releases before the selected sort order", () => {
    const input = [
      release("github:owner/newer-regular", "2024-03-01T00:00:00.000Z", true),
      release(
        "github:owner/older-security",
        "2024-01-01T00:00:00.000Z",
        true,
        "Security update for CVE-2024-12345.",
      ),
      release(
        "github:owner/seen-security",
        "2024-04-01T00:00:00.000Z",
        false,
        "Security update.",
      ),
    ];

    expect(
      ids(sortEnrichedReleases(input, "latest_first", undefined, true)),
    ).toEqual([
      "github:owner/older-security",
      "github:owner/seen-security",
      "github:owner/newer-regular",
    ]);
    expect(
      ids(sortEnrichedReleases(input, "latest_first", undefined, false)),
    ).toEqual([
      "github:owner/seen-security",
      "github:owner/newer-regular",
      "github:owner/older-security",
    ]);
  });

  it("supports oldest-first and repository name ordering", () => {
    expect(
      ids(sortEnrichedReleases(releases, "oldest_first", undefined)),
    ).toEqual([
      "github:owner/old",
      "codeberg:owner/mid",
      "gitlab:gitlab.com/owner/new",
      "unknown:owner/no-release",
    ]);
  });

  it("sorts repository names without provider prefixes or GitLab host segments", () => {
    const input = [
      release("github:z-owner/repo", "2024-01-01T00:00:00.000Z"),
      release("codeberg:a-owner/repo", "2024-01-01T00:00:00.000Z"),
      release("gitlab:gitlab.com/m-owner/repo", "2024-01-01T00:00:00.000Z"),
    ];

    expect(ids(sortEnrichedReleases(input, "repo_az", undefined))).toEqual([
      "codeberg:a-owner/repo",
      "gitlab:gitlab.com/m-owner/repo",
      "github:z-owner/repo",
    ]);
    expect(ids(sortEnrichedReleases(input, "repo_za", undefined))).toEqual([
      "github:z-owner/repo",
      "gitlab:gitlab.com/m-owner/repo",
      "codeberg:a-owner/repo",
    ]);
  });

  it("groups by configurable provider order with unknown providers last", () => {
    expect(
      ids(
        sortEnrichedReleases(releases, "provider_grouped", [
          "codeberg",
          "gitlab",
          "github",
        ]),
      ),
    ).toEqual([
      "codeberg:owner/mid",
      "gitlab:gitlab.com/owner/new",
      "github:owner/old",
      "unknown:owner/no-release",
    ]);
  });
});

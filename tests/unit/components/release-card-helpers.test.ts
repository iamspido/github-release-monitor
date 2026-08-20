import { describe, expect, it } from "vitest";
import {
  getReleaseCardHeading,
  hasCustomRepoSettings,
} from "@/components/release-card-helpers";

describe("getReleaseCardHeading", () => {
  it("always gives an explicitly configured display name priority", () => {
    expect(
      getReleaseCardHeading({
        displayName: "Production Monitor",
        releaseName: "Summer Update",
        releaseTag: "v2.0.0",
        repoId: "github:owner/repo",
      }),
    ).toBe("Production Monitor");
  });

  it("keeps a meaningful release title when no display name is configured", () => {
    expect(
      getReleaseCardHeading({
        releaseName: "Summer Update",
        releaseTag: "v2.0.0",
        repoId: "github:owner/repo",
      }),
    ).toBe("Summer Update");
  });

  it("uses the repository name when the release title repeats the tag", () => {
    expect(
      getReleaseCardHeading({
        releaseName: " V2.0.0 ",
        releaseTag: "v2.0.0",
        repoId: "github:owner/repo",
      }),
    ).toBe("repo");
  });

  it("uses the repository name for a generated tag fallback title", () => {
    expect(
      getReleaseCardHeading({
        releaseName: "Tag: v2.0.0",
        releaseTag: "v2.0.0",
        repoId: "github:owner/repo",
      }),
    ).toBe("repo");
  });
});

describe("hasCustomRepoSettings", () => {
  it("recognizes a repository-specific release selection strategy", () => {
    expect(
      hasCustomRepoSettings({ releaseSelectionStrategy: "highest_version" }),
    ).toBe(true);
  });

  it("recognizes a repository-specific version tag pattern", () => {
    expect(
      hasCustomRepoSettings({
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      }),
    ).toBe(true);
  });

  it("recognizes an explicitly empty pre-release marker override", () => {
    expect(hasCustomRepoSettings({ preReleaseSubChannels: [] })).toBe(true);
  });
});

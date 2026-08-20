import {
  releaseMatchesEffectiveFilters,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import { createDefaultSettings } from "@/lib/storage/settings";
import type { GithubRelease } from "@/types";

function release(tagName: string): GithubRelease {
  return {
    id: 1,
    html_url: `https://example.test/releases/${tagName}`,
    tag_name: tagName,
    name: tagName,
    body: null,
    created_at: "2026-08-20T00:00:00Z",
    published_at: "2026-08-20T00:00:00Z",
    prerelease: false,
    draft: false,
  };
}

describe("releases/filters custom pre-release markers", () => {
  it("inherits, overrides, and explicitly disables global custom markers", () => {
    const globalSettings = {
      ...createDefaultSettings(),
      customPreReleaseMarkers: [" Testing "],
    };

    expect(
      resolveEffectiveRepoFilters({}, globalSettings)
        .effectiveCustomPreReleaseMarkers,
    ).toEqual(["testing"]);
    expect(
      resolveEffectiveRepoFilters(
        { customPreReleaseMarkers: ["EDGE"] },
        globalSettings,
      ).effectiveCustomPreReleaseMarkers,
    ).toEqual(["edge"]);
    expect(
      resolveEffectiveRepoFilters(
        { customPreReleaseMarkers: [] },
        globalSettings,
      ).effectiveCustomPreReleaseMarkers,
    ).toEqual([]);
  });

  it("treats an empty built-in marker list as an explicit override", () => {
    const globalSettings = {
      ...createDefaultSettings(),
      preReleaseSubChannels: ["rc" as const],
    };

    expect(
      resolveEffectiveRepoFilters({ preReleaseSubChannels: [] }, globalSettings)
        .effectivePreReleaseSubChannels,
    ).toEqual([]);
  });

  it("matches configured markers only at marker boundaries", () => {
    const filters = resolveEffectiveRepoFilters(
      {},
      {
        ...createDefaultSettings(),
        releaseChannels: ["prerelease"],
        customPreReleaseMarkers: ["testing"],
      },
    );

    expect(
      releaseMatchesEffectiveFilters(
        release("v1.0.0-testing.1"),
        filters,
        "owner/repo",
      ),
    ).toBe(true);
    expect(
      releaseMatchesEffectiveFilters(
        release("v1.0.0-contesting.1"),
        filters,
        "owner/repo",
      ),
    ).toBe(false);
  });

  it("ignores invalid custom markers", () => {
    const filters = resolveEffectiveRepoFilters(
      {},
      {
        ...createDefaultSettings(),
        releaseChannels: ["prerelease"],
        customPreReleaseMarkers: ["."],
      },
    );

    expect(filters.effectiveCustomPreReleaseMarkers).toEqual([]);
    expect(
      releaseMatchesEffectiveFilters(release("v1.2.3"), filters, "owner/repo"),
    ).toBe(false);
  });

  it("ignores custom markers containing numbers", () => {
    const numericMarkerFilters = resolveEffectiveRepoFilters(
      {},
      {
        ...createDefaultSettings(),
        releaseChannels: ["prerelease"],
        customPreReleaseMarkers: ["test2"],
      },
    );
    expect(numericMarkerFilters.effectiveCustomPreReleaseMarkers).toEqual([]);
    expect(
      releaseMatchesEffectiveFilters(
        release("v1.0.0-test2"),
        numericMarkerFilters,
        "owner/repo",
      ),
    ).toBe(false);
  });
});

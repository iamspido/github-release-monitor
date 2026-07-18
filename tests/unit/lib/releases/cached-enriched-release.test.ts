import { describe, expect, it } from "vitest";
import { toCachedEnrichedRelease } from "@/lib/releases/cached-enriched-release";

describe("toCachedEnrichedRelease", () => {
  it("carries repository display metadata into the initial card data", () => {
    expect(
      toCachedEnrichedRelease({
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
        displayName: "Production Monitor",
        isPinned: true,
        etag: 'W/"keep"',
      }),
    ).toMatchObject({
      repoId: "github:owner/repo",
      repoSettings: { displayName: "Production Monitor", isPinned: true },
      newEtag: 'W/"keep"',
    });
  });
});

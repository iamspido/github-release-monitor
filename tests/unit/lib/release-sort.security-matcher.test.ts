import { describe, expect, it, vi } from "vitest";
import { sortEnrichedReleases } from "@/lib/release-sort";
import type { EnrichedRelease, ReleaseSortOrder } from "@/types";

// Prioritizing new security releases evaluates the real security matcher once
// per new release, not once per comparison of the sort.
const evaluations = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/security-release", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security-release")>();
  return {
    ...actual,
    getSecurityReleaseMatcher: (
      ...args: Parameters<typeof actual.getSecurityReleaseMatcher>
    ) => {
      const matches = actual.getSecurityReleaseMatcher(...args);
      return (
        release: Parameters<
          ReturnType<typeof actual.getSecurityReleaseMatcher>
        >[0],
      ) => {
        evaluations.count++;
        return matches(release);
      };
    },
  };
});

function release(
  repoId: string,
  day: number,
  isNew: boolean,
  body: string,
  isPinned = false,
): EnrichedRelease {
  const date = new Date(Date.UTC(2024, 0, day)).toISOString();
  return {
    repoId,
    repoUrl: `https://example.test/${repoId}`,
    isNew,
    repoSettings: { isPinned },
    release: {
      id: day,
      html_url: `https://example.test/${repoId}/releases/v${day}`,
      tag_name: `v1.${day}.0`,
      name: `v1.${day}.0`,
      body,
      created_at: date,
      published_at: date,
      prerelease: false,
      draft: false,
    } as EnrichedRelease["release"],
  };
}

function releases(): EnrichedRelease[] {
  const list: EnrichedRelease[] = [];
  for (let day = 1; day <= 40; day++) {
    const body =
      day % 5 === 0
        ? `Hotfix HF-${day} for the login form.`
        : day % 7 === 0
          ? "Security update."
          : "Regular maintenance.";
    list.push(release(`github:acme/new-${day}`, day, true, body, day <= 2));
  }
  for (let day = 1; day <= 20; day++) {
    list.push(
      release(`github:acme/seen-${day}`, day, false, "Security update."),
    );
  }
  return list;
}

const SORT_ORDERS: ReleaseSortOrder[] = [
  "latest_first",
  "new_first",
  "oldest_first",
  "repo_az",
  "repo_za",
  "provider_grouped",
];

describe("prioritizing new security releases", () => {
  it.each(SORT_ORDERS)(
    "evaluates the security matcher once per new release when sorting %s",
    (sortOrder) => {
      const input = releases();
      evaluations.count = 0;

      const sorted = sortEnrichedReleases(input, sortOrder, undefined, true, {
        customSecurityPatterns: "/HF-\\d+/",
      });

      const newSecurity = (item: EnrichedRelease) =>
        item.isNew === true &&
        /HF-\d+|Security update/.test(item.release?.body ?? "");
      const unpinned = sorted.filter((item) => !item.repoSettings?.isPinned);
      const firstOther = unpinned.findIndex((item) => !newSecurity(item));
      expect({
        evaluations: evaluations.count,
        pinnedFirst: sorted
          .slice(0, 2)
          .every((item) => item.repoSettings?.isPinned === true),
        securityBeforeOthers: unpinned
          .slice(firstOther)
          .every((item) => !newSecurity(item)),
        newSecurityReleases: unpinned.filter(newSecurity).length,
      }).toEqual({
        evaluations: input.filter((item) => item.isNew).length,
        pinnedFirst: true,
        securityBeforeOthers: true,
        newSecurityReleases: 12,
      });
    },
  );

  it("evaluates the security matcher not at all when new security releases are not prioritized", () => {
    evaluations.count = 0;

    sortEnrichedReleases(releases(), "latest_first", undefined, false, {
      customSecurityPatterns: "/HF-\\d+/",
    });

    expect(evaluations.count).toBe(0);
  });
});

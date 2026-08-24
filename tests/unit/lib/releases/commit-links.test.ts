import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyVerifiedCommitLinks,
  findCommitRefCandidates,
  resolveCommitLinkCandidates,
} from "@/lib/releases/commit-links";
import type { CommitLink, GithubRelease } from "@/types";

function createRelease(body: string): GithubRelease {
  return {
    id: 1,
    html_url: "https://example.test/owner/repo/releases/tag/v1",
    tag_name: "v1",
    name: "v1",
    body,
    created_at: "2026-01-01T00:00:00.000Z",
    published_at: "2026-01-01T00:00:00.000Z",
    prerelease: false,
    draft: false,
  };
}

function createLink(ref: string): CommitLink {
  const sha = `${ref}${"a".repeat(40 - ref.length)}`;
  return {
    ref,
    sha,
    url: `https://example.test/owner/repo/commit/${sha}`,
  };
}

describe("commit-link resolution", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores hashes in existing links, code, and raw HTML", () => {
    const markdown = [
      "Visible abcdef1.",
      "[Already linked 1234567](https://example.test/commit/1234567)",
      "Inline `7654321`.",
      "```text",
      "deadbee",
      "```",
      '<a href="https://example.test/commit/feedbee">feedbee</a>',
    ].join("\n\n");

    expect(findCommitRefCandidates(markdown)).toEqual(["abcdef1"]);
  });

  it("limits the total candidates retained for a release", () => {
    const candidates = Array.from({ length: 150 }, (_, index) =>
      index.toString(16).padStart(7, "a"),
    );

    expect(findCommitRefCandidates(candidates.join(" "))).toEqual(
      candidates.slice(0, 100),
    );
  });

  it("limits each attempt and uses bounded concurrency", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      index.toString(16).padStart(7, "0"),
    );
    let active = 0;
    let maxActive = 0;
    let calls = 0;

    const result = await resolveCommitLinkCandidates({
      candidates,
      concurrency: 3,
      deadline: Date.now() + 5_000,
      maxCandidates: 10,
      resolve: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return { status: "not_found" };
      },
    });

    expect(calls).toBe(10);
    expect(maxActive).toBe(3);
    expect(result.checkedRefs).toEqual(candidates.slice(0, 10));
    expect(result.complete).toBe(false);
  });

  it("persists partial links and resumes only unchecked references", async () => {
    const firstRef = "abcdef1";
    const secondRef = "1234567";
    const firstLink = createLink(firstRef);
    const secondLink = createLink(secondRef);
    const release = createRelease(`Fix ${firstRef} and ${secondRef}`);

    await applyVerifiedCommitLinks({
      release,
      resolve: async (candidates) => ({
        links: [firstLink],
        checkedRefs: [candidates[0]],
        complete: false,
      }),
    });

    expect(release.commit_links).toEqual([firstLink]);
    expect(release.commit_links_resolved_at).toBeUndefined();
    expect(release.commit_links_retry).toEqual(
      expect.objectContaining({
        attempts: 0,
        checked_refs: [firstRef],
      }),
    );

    if (!release.commit_links_retry) throw new Error("Expected retry state.");
    release.commit_links_retry.retry_at = "2020-01-01T00:00:00.000Z";
    let resumedCandidates: readonly string[] = [];
    await applyVerifiedCommitLinks({
      release,
      resolve: async (candidates) => {
        resumedCandidates = candidates;
        return {
          links: [secondLink],
          checkedRefs: [candidates[0]],
          complete: true,
        };
      },
    });

    expect(resumedCandidates).toEqual([secondRef]);
    expect(release.commit_links).toEqual([firstLink, secondLink]);
    expect(release.commit_links_resolved_at).toBeDefined();
    expect(release.commit_links_retry).toBeUndefined();
  });

  it("continues successful batches promptly without increasing error backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-01-01T00:00:00.000Z");
    const refs = ["abcdef1", "1234567", "7654321"];
    const release = createRelease(refs.join(" "));

    await applyVerifiedCommitLinks({
      release,
      resolve: async (candidates) => ({
        links: [],
        checkedRefs: [candidates[0]],
        complete: false,
      }),
    });

    expect(release.commit_links_retry).toEqual({
      attempts: 0,
      retry_at: "2026-01-01T00:01:00.000Z",
      checked_refs: [refs[0]],
    });

    vi.advanceTimersByTime(60_000);
    await applyVerifiedCommitLinks({
      release,
      resolve: async (candidates) => ({
        links: [],
        checkedRefs: [candidates[0]],
        complete: false,
      }),
    });

    expect(release.commit_links_retry).toEqual({
      attempts: 0,
      retry_at: "2026-01-01T00:02:00.000Z",
      checked_refs: refs.slice(0, 2),
    });

    vi.advanceTimersByTime(60_000);
    await applyVerifiedCommitLinks({
      release,
      resolve: async () => null,
    });

    expect(release.commit_links_retry).toEqual({
      attempts: 1,
      retry_at: "2026-01-01T00:17:00.000Z",
      checked_refs: refs.slice(0, 2),
    });
  });
});

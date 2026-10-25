import { RE2JS } from "re2js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sortEnrichedReleases } from "@/lib/release-sort";
import { isSecurityRelease } from "@/lib/security-release";
import type { EnrichedRelease } from "@/types";

// A sort reuses the security matcher kept per options, so the real RE2 engine
// (counted by a pass-through spy) compiles custom security lines only once.

const compiles = vi.spyOn(RE2JS, "compile");

beforeEach(() => {
  compiles.mockClear();
});

afterAll(() => {
  compiles.mockRestore();
});

function release(repoId: string, day: number, body: string): EnrichedRelease {
  const date = new Date(Date.UTC(2024, 0, day)).toISOString();
  return {
    repoId,
    repoUrl: `https://example.test/${repoId}`,
    isNew: true,
    repoSettings: { isPinned: false },
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

function releases(keyword: string, hotfix: string): EnrichedRelease[] {
  return [
    release("github:acme/regular", 3, "Regular maintenance."),
    release("github:acme/keyword", 2, `Contains a ${keyword}.`),
    release("github:acme/hotfix", 1, `Hotfix ${hotfix} for the login form.`),
  ];
}

const ids = (list: EnrichedRelease[]) => list.map((item) => item.repoId);

describe("prioritizing new security releases with custom security patterns", () => {
  it("two sorts with the same options compile the custom security lines once", () => {
    const options = { customSecurityPatterns: "auth-hardening\n/HFA-\\d+/" };

    const first = sortEnrichedReleases(
      releases("auth-hardening", "HFA-1"),
      "latest_first",
      undefined,
      true,
      options,
    );
    const compiledByFirst = compiles.mock.calls.length;
    const second = sortEnrichedReleases(
      releases("auth-hardening", "HFA-1"),
      "latest_first",
      undefined,
      true,
      { ...options },
    );

    expect({
      compiledByFirst,
      compiledBySecond: compiles.mock.calls.length - compiledByFirst,
      first: ids(first),
      second: ids(second),
    }).toEqual({
      compiledByFirst: 2,
      compiledBySecond: 0,
      first: [
        "github:acme/keyword",
        "github:acme/hotfix",
        "github:acme/regular",
      ],
      second: [
        "github:acme/keyword",
        "github:acme/hotfix",
        "github:acme/regular",
      ],
    });
  });

  it("a sort uses the matcher isSecurityRelease built for the same options and compiles nothing", () => {
    const options = { customSecurityPatterns: "cookie-fix\n/HFB-\\d+/" };
    const shown = releases("cookie-fix", "HFB-2");
    const marked = shown.map((item) =>
      isSecurityRelease(item.release, options),
    );
    const compiledByCards = compiles.mock.calls.length;

    const sorted = sortEnrichedReleases(
      shown,
      "latest_first",
      undefined,
      true,
      options,
    );

    expect({
      marked,
      compiledByCards,
      compiledBySort: compiles.mock.calls.length - compiledByCards,
      sorted: ids(sorted),
    }).toEqual({
      marked: [false, true, true],
      compiledByCards: 2,
      compiledBySort: 0,
      sorted: [
        "github:acme/keyword",
        "github:acme/hotfix",
        "github:acme/regular",
      ],
    });
  });

  it("a sort with other custom security lines builds a matcher of these lines", () => {
    sortEnrichedReleases(
      releases("token-fix", "HFC-3"),
      "latest_first",
      undefined,
      true,
      { customSecurityPatterns: "token-fix\n/HFC-\\d+/" },
    );
    const compiledBefore = compiles.mock.calls.length;

    const sorted = sortEnrichedReleases(
      releases("token-fix", "HFC-3"),
      "latest_first",
      undefined,
      true,
      { customSecurityPatterns: "token-fix" },
    );

    expect({
      compiled: compiles.mock.calls
        .slice(compiledBefore)
        .map(([source]) => source),
      sorted: ids(sorted),
    }).toEqual({
      compiled: [RE2JS.quote("token-fix")],
      sorted: [
        "github:acme/keyword",
        "github:acme/regular",
        "github:acme/hotfix",
      ],
    });
  });
});

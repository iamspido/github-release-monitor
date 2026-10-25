import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffectiveReleaseMatcher,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import {
  getReleaseSelectionErrorType,
  selectMatchingRelease,
} from "@/lib/releases/selection";
import { isSecurityRelease } from "@/lib/security-release";
import type { AppSettings, GithubRelease, Repository } from "@/types";

// The real release filters keep ordinary patterns, and a stored pattern the RE2
// engine cannot evaluate fails closed instead of letting every release through.

const REPO_ID = "github:acme/tool";
const settings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 0,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
} as AppSettings;

function release(tag: string, index = 0): GithubRelease {
  return {
    id: index + 1,
    html_url: `https://github.com/acme/tool/releases/tag/${index}`,
    tag_name: tag,
    name: tag,
    body: null,
    created_at: "2026-10-01T00:00:00Z",
    published_at: new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString(),
    prerelease: false,
    draft: false,
  };
}

function matcher(repository: Partial<Repository>) {
  return createEffectiveReleaseMatcher(
    resolveEffectiveRepoFilters(repository, settings),
    REPO_ID,
  );
}

function passes(repository: Partial<Repository>, tag: string) {
  return matcher(repository)(release(tag));
}

function errorLines(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("[ERROR]") && line.includes(REPO_ID));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ordinary release filters", () => {
  it.each([
    ["include", "^v\\d+\\.\\d+", "v1.2.3"],
    ["include", "^v\\d+\\.\\d+", "V1.2.3"],
    ["include", "^v\\d+\\.\\d+", "1.2.3"],
    ["include", "^release-\\d{4}-\\d{2}-\\d{2}$", "Release-2024-01-15"],
    ["include", "nightly|latest", "NIGHTLY"],
    ["include", "^[\\w@/.-]+@\\d", "@scope/pkg@2.0.0"],
    ["exclude", "beta|rc", "v1.0.0-RC1"],
    ["exclude", "beta|rc", "v1.0.0"],
    ["exclude", "-dev$", "v1.2.3-DEV"],
    ["exclude", "\\+build", "v1.2.3+build.5"],
    ["exclude", "ü", "v1.2.3-Ü"],
  ] as const)(
    "an %s filter %s decides on %s as the former case-insensitive evaluation did",
    (kind, pattern, tag) => {
      const former = new RegExp(pattern, "i").test(tag);
      const repository =
        kind === "include"
          ? { includeRegex: pattern }
          : { excludeRegex: pattern };

      expect(passes(repository, tag)).toBe(
        kind === "include" ? former : !former,
      );
    },
  );

  it("the exclude filter still takes precedence over the include filter", () => {
    const repository = { includeRegex: "^v", excludeRegex: "-dev$" };

    expect({
      stable: passes(repository, "v1.0.0"),
      dev: passes(repository, "v1.0.0-DEV"),
      other: passes(repository, "1.0.0"),
    }).toEqual({ stable: true, dev: false, other: false });
  });
});

describe("stored filters the linear-time engine cannot evaluate", () => {
  it.each([
    ["include", "a lookbehind", { includeRegex: "(?<=v)1" }],
    ["exclude", "a negative lookahead", { excludeRegex: "^(?!v)" }],
    ["include", "a backreference", { includeRegex: "^v(\\d)\\.\\1" }],
    [
      "exclude",
      "a pattern above 512 characters",
      { excludeRegex: "x".repeat(513) },
    ],
    ["include", "a syntax error", { includeRegex: "([" }],
  ] as const)(
    "an %s filter with %s lets no release through and logs one ERROR line per matcher",
    (_kind, _construct, repository) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const first = matcher(repository);
      const firstResults = ["v1.1.0", "v1.0.0", "v1.0.0-rc.1"].map((tag) =>
        first(release(tag)),
      );
      const linesAfterFirst = errorLines(error).length;
      const second = matcher(repository);
      const secondResults = ["v1.1.0", "v1.0.0"].map((tag) =>
        second(release(tag)),
      );

      expect({
        firstResults,
        secondResults,
        linesAfterFirst,
        lines: errorLines(error).length,
        noReleaseMatches: errorLines(error).every((line) =>
          line.includes("No release matches"),
        ),
      }).toEqual({
        firstResults: [false, false, false],
        secondResults: [false, false],
        linesAfterFirst: 1,
        lines: 2,
        noReleaseMatches: true,
      });
    },
  );

  it("a selection with a stored unusable filter selects no release", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      selectMatchingRelease({
        releases: ["v1.0.0", "v1.1.0"].map(release),
        filters: resolveEffectiveRepoFilters(
          { excludeRegex: "^(?!v)" },
          settings,
        ),
        repoIdForLog: REPO_ID,
        strategy: "newest",
      }),
    ).toBeNull();
  });
});

describe("tag names above 255 characters", () => {
  const longTag = `v${"1".repeat(300)}`;
  const longestEvaluated = `v${"1".repeat(254)}`;

  it("never pass an include or exclude filter, and pass as before without one", () => {
    expect({
      include: passes({ includeRegex: "^v" }, longTag),
      exclude: passes({ excludeRegex: "^x" }, longTag),
      none: passes({}, longTag),
      includeAt255: passes({ includeRegex: "^v" }, longestEvaluated),
      excludeAt255: passes({ excludeRegex: "^x" }, longestEvaluated),
    }).toEqual({
      include: false,
      exclude: false,
      none: true,
      includeAt255: true,
      excludeAt255: true,
    });
  });
});

describe("a stored version tag pattern the linear-time engine cannot evaluate", () => {
  const filters = resolveEffectiveRepoFilters(
    {
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
    },
    settings,
  );
  const releases = ["v1.2.3", "v1.2.4"].map(release);

  it("selects no release and reports that no tag matches the version tag pattern, as an invalid pattern did", () => {
    expect({
      selected:
        selectMatchingRelease({
          releases,
          filters,
          repoIdForLog: REPO_ID,
          strategy: "highest_version",
        })?.tag_name ?? null,
      errorType: getReleaseSelectionErrorType({
        releases,
        strategy: "highest_version",
        versionTagPattern: filters.versionTagPattern,
      }),
      classifiedByTag: matcher({
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)(?!-rc)",
      })(release("v1.2.3")),
    }).toEqual({
      selected: null,
      errorType: "no_matching_version_tags",
      classifiedByTag: true,
    });
  });
});

describe("a stored custom security pattern the linear-time engine cannot evaluate", () => {
  it("marks no release, while the other lines and the built-in patterns keep working", () => {
    const options = {
      includeDefaultSecurityPatterns: false,
      customSecurityPatterns: "/^(?=.*hardening)/i\nbreaking",
    };

    expect({
      lookahead: isSecurityRelease(
        { name: "Auth hardening", tag_name: "v2.0.0", body: null },
        options,
      ),
      keyword: isSecurityRelease(
        { name: "v2.0.0", tag_name: "v2.0.0", body: "A breaking change." },
        options,
      ),
      builtIn: isSecurityRelease(
        { name: "v2.0.1", tag_name: "v2.0.1", body: "A security fix." },
        { ...options, includeDefaultSecurityPatterns: true },
      ),
    }).toEqual({ lookahead: false, keyword: true, builtIn: true });
  });
});

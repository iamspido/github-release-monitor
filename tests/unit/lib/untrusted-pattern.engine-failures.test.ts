import { Matcher, RE2JS, RE2JSInternalException } from "re2js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffectiveReleaseMatcher,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import {
  getReleaseSelectionErrorType,
  selectMatchingRelease,
} from "@/lib/releases/selection";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import {
  getInvalidCustomSecurityPattern,
  isSecurityRelease,
} from "@/lib/security-release";
import {
  compileUntrustedPattern,
  regexFilterError,
  type UntrustedPatternOptions,
} from "@/lib/untrusted-pattern";
import type { AppSettings, GithubRelease } from "@/types";

// Capturing groups around empty classes evaluate like JavaScript, and an engine
// fault (a spy on re2js) leaves the pattern unusable in every real consumer.

afterEach(() => {
  vi.restoreAllMocks();
});

function attempt<T>(
  operation: () => T,
): { value: T } | { threw: string | undefined } {
  try {
    return { value: operation() };
  } catch (error) {
    return { threw: (error as Error | undefined)?.name };
  }
}

const TEXTS = ["", "v", "v1", "v1.2.3", "_", "a", "K", "release-1.0.0"];

describe("a capturing group around an empty class under a quantifier", () => {
  it("include and exclude filters with a capturing group around an empty class under a quantifier that allows zero repetitions are accepted and evaluated like JavaScript", () => {
    const filters = [
      "([^\\d\\D])*",
      "([^\\s\\S])*",
      "(?<n>[^\\w\\W])*",
      "([^\\d\\D]){0,3}",
      "([^\\d\\D])*?",
      "([^\\d\\D])??",
      "(?:a([^\\d\\D]))?b",
      "(([^\\d\\D]))*",
      "(?:([^\\d\\D])+)?",
      "^v\\d+([^\\d\\D])*",
      "([^\\WA-Z0-9_])*",
    ];
    const results = filters.map((filter) => {
      const pattern = compileUntrustedPattern(filter, "i").pattern;
      return {
        filter,
        error: regexFilterError(filter),
        differs: TEXTS.filter(
          (text) =>
            JSON.stringify(attempt(() => pattern?.test(text))) !==
            JSON.stringify({ value: new RegExp(filter, "i").test(text) }),
        ),
      };
    });

    expect(results).toEqual(
      filters.map((filter) => ({ filter, error: null, differs: [] })),
    );
  });

  it("version tag patterns of this kind are accepted and extract the version as JavaScript did", () => {
    const patterns = [
      "^v(?<version>\\d+)([^\\d\\D])*",
      "^v(?<version>\\d+\\.\\d+\\.\\d+)([^\\d\\D])*$",
      "(?<version>\\d+)([^\\s\\S]){0,3}",
    ];
    const results = patterns.map((pattern) => {
      const compiled = compileUntrustedPattern(pattern, "", {
        captures: true,
      }).pattern;
      return {
        pattern,
        validation: validateVersionTagPattern(pattern),
        differs: TEXTS.filter(
          (text) =>
            JSON.stringify(attempt(() => compiled?.groups(text)?.version)) !==
            JSON.stringify({
              value: new RegExp(pattern).exec(text)?.groups?.version,
            }),
        ),
      };
    });

    expect(results).toEqual(
      patterns.map((pattern) => ({ pattern, validation: null, differs: [] })),
    );
  });

  it("an empty class that RE2 removes is still accepted and evaluated like JavaScript, also as a custom security line, whose groups do not capture", () => {
    const accepted = [
      "[^\\d\\D]",
      "[^\\d\\D]*",
      "a|([^\\d\\D])",
      "([^\\d\\D])",
      "x[^\\s\\S]?y",
      "([^\\d\\D]|v)+\\d",
      "(?:[^\\w\\W])*v",
    ];
    const results = accepted.map((source) => {
      const compiled = compileUntrustedPattern(source, "i");
      if (!compiled.pattern) return { source, error: compiled.error };
      const pattern = compiled.pattern;
      return {
        source,
        differs: TEXTS.filter(
          (text) =>
            JSON.stringify(attempt(() => pattern.test(text))) !==
            JSON.stringify({ value: new RegExp(source, "i").test(text) }),
        ),
      };
    });

    expect({
      results,
      securityLine: getInvalidCustomSecurityPattern("/([^\\d\\D])*v1/i"),
      marks: attempt(() =>
        isSecurityRelease(
          { name: "v1", tag_name: "v1", body: "" },
          {
            includeDefaultSecurityPatterns: false,
            customSecurityPatterns: "/([^\\d\\D])*v1/i",
          },
        ),
      ),
    }).toEqual({
      results: accepted.map((source) => ({ source, differs: [] })),
      securityLine: null,
      marks: { value: true },
    });
  });

  it("generated patterns rich in empty classes, captures and nested empty repetitions: no accepted pattern throws when it is evaluated", () => {
    let state = 617;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)];
    const empty = [
      "[^\\d\\D]",
      "[^\\s\\S]",
      "[^\\w\\W]",
      "[^\\WA-Z0-9_]",
      "[^\\D\\d]",
    ];
    const other = ["a", "v", "\\d", "\\w", ".", "(?:)", "()", "(|a)", "\\b"];
    const quantifiers = ["", "", "?", "*", "+", "??", "*?", "{0,3}", "{2,}"];
    let groups = 0;
    const atom = (depth: number): string => {
      const choice = next();
      if (choice < 0.3) return pick(empty);
      if (choice < 0.65 || depth >= 2) return pick(other);
      const open = pick(["(", "(", "(?:", `(?<g${groups++}>`]);
      const body = Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
        quantified(depth + 1),
      ).join("");
      return `${open}${next() < 0.25 ? `${body}|${pick(other)}` : body})`;
    };
    const quantified = (depth: number) => {
      const value = atom(depth);
      return value === "\\b" ? value : `${value}${pick(quantifiers)}`;
    };
    const modes: Array<[string, UntrustedPatternOptions]> = [
      ["i", {}],
      ["", { captures: true }],
      ["im", {}],
    ];
    let accepted = 0;
    let acceptedWithEmptyClass = 0;
    const throwing: string[] = [];
    for (let index = 0; index < 1500; index++) {
      const source = Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
        quantified(0),
      ).join("");
      for (const [flags, options] of modes) {
        try {
          new RegExp(source, flags);
        } catch {
          continue;
        }
        const compiled = compileUntrustedPattern(source, flags, options);
        if (!compiled.pattern) continue;
        accepted++;
        if (empty.some((item) => source.includes(item)))
          acceptedWithEmptyClass++;
        const pattern = compiled.pattern;
        for (const text of [...TEXTS, "ab1".repeat(100)])
          for (const evaluate of [
            (): unknown => pattern.test(text),
            (): unknown => pattern.groups(text),
          ])
            if ("threw" in attempt(evaluate))
              throwing.push(`/${source}/${flags} on ${text.length}`);
      }
    }

    expect({ throwing: throwing.slice(0, 5), count: throwing.length }).toEqual({
      throwing: [],
      count: 0,
    });
    expect(accepted).toBeGreaterThan(1000);
    expect(acceptedWithEmptyClass).toBeGreaterThan(300);
  });
});

describe("an engine exception while an accepted pattern is evaluated", () => {
  const settings = {
    timeFormat: "24h",
    locale: "en",
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 100,
    parallelRepoFetches: 1,
    releaseChannels: ["stable"],
  } as AppSettings;
  const release = (tag: string, index: number): GithubRelease => ({
    id: index + 1,
    html_url: `https://github.com/acme/tool/releases/tag/${index}`,
    tag_name: tag,
    name: tag,
    body: null,
    created_at: "2026-10-01T00:00:00Z",
    published_at: new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString(),
    prerelease: false,
    draft: false,
  });
  const engineFault = () =>
    vi.spyOn(Matcher.prototype, "find").mockImplementation(() => {
      throw new RE2JSInternalException("unexpected InstFail");
    });

  it("an include filter is unusable: the matcher evaluates it once, lets no release through, logs one ERROR line, and the selection selects nothing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const find = engineFault();
    const filters = resolveEffectiveRepoFilters(
      { includeRegex: "^v\\d" },
      settings,
    );
    const matches = createEffectiveReleaseMatcher(filters, "github:acme/tool");

    const first = attempt(() => matches(release("v1.0.0", 0)));
    const second = attempt(() => matches(release("v2.0.0", 1)));
    const evaluated = find.mock.calls.length;
    const selected = attempt(
      () =>
        selectMatchingRelease({
          releases: ["v1.0.0", "v1.0.1"].map(release),
          filters,
          repoIdForLog: "github:acme/tool",
          strategy: "newest",
        })?.tag_name ?? null,
    );

    expect({
      first,
      second,
      evaluated,
      selected,
      errorLines: error.mock.calls.filter((call) =>
        String(call[0]).includes("No release matches"),
      ).length,
    }).toEqual({
      first: { value: false },
      second: { value: false },
      evaluated: 1,
      selected: { value: null },
      errorLines: 2,
    });
  });

  it("a selection by highest version whose version tag pattern fails after the first tag selects nothing, never a release from the tags evaluated before", () => {
    const VERSION = "^v(?<version>\\d+\\.\\d+\\.\\d+)$";
    const exec = RE2JS.prototype.exec;
    vi.spyOn(RE2JS.prototype, "exec")
      .mockImplementationOnce(function (
        this: RE2JS,
        input: Parameters<RE2JS["exec"]>[0],
      ) {
        return exec.call(this, input);
      })
      .mockImplementation(() => {
        throw new RE2JSInternalException("unexpected InstFail");
      });
    const filters = resolveEffectiveRepoFilters(
      {
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: VERSION,
      },
      settings,
    );
    const releases = ["v1.0.0", "v1.0.1", "v1.0.2"].map(release);

    expect({
      selected: attempt(
        () =>
          selectMatchingRelease({
            releases,
            filters,
            repoIdForLog: "github:acme/tool",
            strategy: filters.effectiveReleaseSelectionStrategy,
          })?.tag_name ?? null,
      ),
      errorType: attempt(() =>
        getReleaseSelectionErrorType({
          releases,
          strategy: "highest_version",
          versionTagPattern: VERSION,
        }),
      ),
    }).toEqual({
      selected: { value: null },
      errorType: { value: "no_matching_version_tags" },
    });
  });

  it("a custom security line whose evaluation throws marks nothing; the built-in patterns still mark", () => {
    const value = "/q617-(?:fixed|patched) \\d+/i";
    const fault = () => {
      throw new RE2JSInternalException("unexpected InstFail");
    };
    const find = vi.spyOn(Matcher.prototype, "find").mockImplementation(fault);
    const dfa = vi.spyOn(RE2JS.prototype, "test").mockImplementation(fault);
    const options = {
      includeDefaultSecurityPatterns: false,
      customSecurityPatterns: value,
    };

    const first = attempt(() =>
      isSecurityRelease(
        { name: "v1", tag_name: "v1", body: "q617-fixed 1" },
        options,
      ),
    );
    const second = attempt(() =>
      isSecurityRelease(
        { name: "v2", tag_name: "v2", body: "q617-patched 2" },
        options,
      ),
    );
    const builtIn = attempt(() =>
      isSecurityRelease(
        { name: "v3", tag_name: "v3", body: "A security fix." },
        { ...options, includeDefaultSecurityPatterns: true },
      ),
    );

    expect({
      first,
      second,
      builtIn,
      evaluated: find.mock.calls.length + dfa.mock.calls.length,
      stored: getInvalidCustomSecurityPattern(value),
    }).toEqual({
      first: { value: false },
      second: { value: false },
      builtIn: { value: true },
      evaluated: 1,
      stored: null,
    });
  });
});

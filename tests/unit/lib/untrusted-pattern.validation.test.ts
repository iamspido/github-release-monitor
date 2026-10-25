import { describe, expect, it } from "vitest";
import {
  createEffectiveReleaseMatcher,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import {
  compileVersionTagPattern,
  validateVersionTagPattern,
} from "@/lib/releases/version-tag-pattern";
import { parseImportedRepository } from "@/lib/repositories/repository-import";
import {
  getInvalidCustomSecurityPattern,
  isSecurityRelease,
} from "@/lib/security-release";
import { validateRegexInput } from "@/lib/settings/form-model";
import { prepareSettingsUpdate } from "@/lib/settings/update-command";
import { createDefaultSettings } from "@/lib/storage/settings";
import { compileUntrustedPattern } from "@/lib/untrusted-pattern";
import type { AppSettings, GithubRelease, Repository } from "@/types";

// Patterns RE2 cannot evaluate as JavaScript did, or above 512 characters, are
// refused by every real validation path. Accepted ones keep their meaning.

const filterReason = (pattern: string) =>
  compileUntrustedPattern(pattern.trim(), "i").error ?? null;
const versionReason = (pattern: string) =>
  compileUntrustedPattern(pattern, "", { captures: true }).error ?? null;
const securityLineReason = (line: string) => {
  if (getInvalidCustomSecurityPattern(line) === null) return null;
  const literal = /^\/(.+)\/([a-z]*)$/i.exec(line);
  return literal
    ? (compileUntrustedPattern(literal[1], literal[2], { discardGroups: true })
        .error ?? null)
    : "too_long";
};

const UNSUPPORTED = [
  ["negative lookahead", "^(?!.*-rc)"],
  ["lookahead", "^v\\d+(?=-)"],
  ["lookbehind", "(?<=v)\\d+"],
  ["negative lookbehind", "(?<!pre-)release"],
  ["backreference", "^(\\d)\\1"],
  ["named backreference", "^(?<major>\\d)\\.\\k<major>"],
  ["UTF-16 escape of a surrogate pair", "^\\ud83d\\ude00"],
  ["control escape", "\\cJ"],
  ["repeat count above 1000", "^a{1001}$"],
  ["identity escape RE2 reads as an anchor", "^v\\A"],
  ["identity escape RE2 reads as end of text", "rc\\z"],
  ["identity escape RE2 reads as a Unicode class", "\\pL"],
  ["identity escape RE2 reads as a code point", "\\x{41}"],
  ["bracket expression RE2 reads as a POSIX class", "[[:digit:]]"],
  ["empty class RE2 reads as a literal bracket", "[]a]"],
] as const;

describe("include and exclude filters", () => {
  it.each(UNSUPPORTED)(
    "refuses a %s as an invalid filter, since RE2 cannot evaluate it",
    (_, pattern) => {
      expect({
        accepted: new RegExp(pattern, "i") instanceof RegExp,
        reason: filterReason(pattern),
        validation: validateRegexInput(pattern),
      }).toEqual({
        accepted: true,
        reason: "unsupported",
        validation: "invalid",
      });
    },
  );

  it("refuses a pattern above 512 characters and accepts one of 512", () => {
    const at = `^(?:${"[0-9a-z._-]".repeat(46)})$`;
    const above = `^${"a".repeat(512)}`;
    expect({
      above: validateRegexInput(above),
      aboveReason: filterReason(above),
      length: at.length,
      at: validateRegexInput(at),
    }).toEqual({
      above: "invalid",
      aboveReason: "too_long",
      length: 512,
      at: null,
    });
  });

  it("still reports a syntax error as invalid and accepts the documented example", () => {
    expect({
      broken: validateRegexInput("(["),
      brokenReason: filterReason("(["),
      example: validateRegexInput("^v[0-9]+\\.[0-9]+$"),
      empty: validateRegexInput("   "),
    }).toEqual({
      broken: "invalid",
      brokenReason: "invalid",
      example: null,
      empty: null,
    });
  });

  it("refuses an unsupported or too long global filter when it is saved", () => {
    const current = createDefaultSettings();

    expect({
      include: prepareSettingsUpdate(
        { includeRegex: "^(?!.*-rc)" },
        current,
        true,
      ),
      exclude: prepareSettingsUpdate(
        { excludeRegex: "a".repeat(513) },
        current,
        true,
      ),
    }).toEqual({
      include: {
        ok: false,
        errorKey: "regex_error_invalid",
        locale: current.locale,
      },
      exclude: {
        ok: false,
        errorKey: "regex_error_invalid",
        locale: current.locale,
      },
    });
  });
});

describe("version tag patterns", () => {
  it("refuses a lookaround or backreference as invalid, since RE2 cannot evaluate it", () => {
    const patterns = {
      lookahead: "^v(?<version>\\d+)(?!-rc)",
      lookbehind: "(?<=docker/)(?<version>\\d+)",
      backreference: "^(?<version>(\\d)\\2)$",
    };

    expect(
      Object.fromEntries(
        Object.entries(patterns).map(([name, pattern]) => [
          name,
          [validateVersionTagPattern(pattern), versionReason(pattern)],
        ]),
      ),
    ).toEqual({
      lookahead: ["invalid", "unsupported"],
      lookbehind: ["invalid", "unsupported"],
      backreference: ["invalid", "unsupported"],
    });
  });

  it("checks the pattern itself, not a wrapped copy of it", () => {
    expect(validateVersionTagPattern("a)|(?<version>b")).toBe("invalid");
  });

  it("refuses RE2's own named-group syntax as invalid and keeps the documented example", () => {
    expect({
      re2: validateVersionTagPattern("^v(?P<version>\\d+\\.\\d+)$"),
      example: validateVersionTagPattern(
        "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$",
      ),
      missing: validateVersionTagPattern("^v(\\d+)$"),
    }).toEqual({
      re2: "invalid",
      example: null,
      missing: "missing_version_group",
    });
  });
});

describe("custom security patterns", () => {
  it("refuses a lookaround, a sticky or set flag and a pattern above 512 characters when they are saved", () => {
    const current = createDefaultSettings();
    const errorKey = (customSecurityPatterns: string) => {
      const result = prepareSettingsUpdate(
        { customSecurityPatterns },
        current,
        true,
      );
      return result.ok ? null : result.errorKey;
    };
    const lines = {
      lookbehind: "breaking\n/(?<=CVE-)\\d+/",
      sticky: "/security/y",
      unicodeSets: "/[\\p{L}--[a-z]]/v",
      longLiteral: `/${"a".repeat(513)}/`,
      longKeyword: "k".repeat(513),
      invalid: "/[/",
      valid: "breaking\n/CVE-\\d{4}-\\d{4,}/i",
    };

    expect(
      Object.fromEntries(
        Object.entries(lines).map(([name, value]) => [
          name,
          [errorKey(value), securityLineReason(value.split("\n").at(-1) ?? "")],
        ]),
      ),
    ).toEqual({
      lookbehind: ["security_patterns_error_invalid", "unsupported"],
      sticky: ["security_patterns_error_invalid", "unsupported"],
      unicodeSets: ["security_patterns_error_invalid", "unsupported"],
      longLiteral: ["security_patterns_error_invalid", "too_long"],
      longKeyword: ["security_patterns_error_invalid", "too_long"],
      invalid: ["security_patterns_error_invalid", "invalid"],
      valid: [null, null],
    });
  });

  it("a stored unsupported custom pattern marks no release, while the others keep working", () => {
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
    }).toEqual({ lookahead: false, keyword: true });
  });

  it("multiline anchors see the line ends of a body written with CRLF as JavaScript did", () => {
    expect(
      isSecurityRelease(
        {
          name: "v2.0.0",
          tag_name: "v2.0.0",
          body: "## Changes\r\n## Security\r\n- XSS in the editor",
        },
        {
          includeDefaultSecurityPatterns: false,
          customSecurityPatterns: "/^## Security$/m",
        },
      ),
    ).toBe(true);
  });
});

describe("imports", () => {
  it("the import parser does not run a version tag pattern to read it", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/acme/tool",
        versionTagPattern: "^v(?<version>\\d+)(?!-rc)",
      }),
    ).not.toHaveProperty("versionTagPattern");
  });
});

const LINE_GROUP = "^(?<line>[^x]+)$";
const RESET_GROUP = "^(?:(?<version>\\d+)|x)+$";
const OPTIONAL_GROUP = "^v(?<version>\\d*)?";
const MODIFIER_GROUP = "(?i:a|[b])";

const settings = {
  ...createDefaultSettings(),
  releaseChannels: ["stable", "prerelease"],
} as AppSettings;

function release(tag: string): GithubRelease {
  return {
    id: 1,
    html_url: "https://github.com/acme/tool/releases/tag/x",
    tag_name: tag,
    name: tag,
    body: null,
    created_at: "2026-10-01T00:00:00Z",
    published_at: "2026-10-01T00:00:00Z",
    prerelease: false,
    draft: false,
  };
}

function passes(repository: Partial<Repository>, tag: string) {
  return createEffectiveReleaseMatcher(
    resolveEffectiveRepoFilters(repository, settings),
    "github:acme/tool",
  )(release(tag));
}

function marks(line: string, text: string) {
  return isSecurityRelease(
    { name: text, tag_name: "x", body: null },
    { includeDefaultSecurityPatterns: false, customSecurityPatterns: line },
  );
}

describe("the release filters read \\s, \\S and . as JavaScript did", () => {
  it.each([
    [
      "an exclude filter \\s and U+00A0",
      { excludeRegex: "\\s" },
      "v1.0.0\u00a0beta",
    ],
    [
      "an exclude filter \\s and U+3000",
      { excludeRegex: "\\s" },
      "v1.0.0\u3000rc",
    ],
    [
      "an include filter ^\\S+$ and U+00A0",
      { includeRegex: "^\\S+$" },
      "v1.0.0\u00a0x",
    ],
    [
      "an include filter ^v1.0$ and U+2028",
      { includeRegex: "^v1.0$" },
      "v1\u20280",
    ],
    [
      "an include filter [^\\s]+ and U+FEFF",
      { includeRegex: "^[^\\s]+$" },
      "v1\ufeff0",
    ],
  ])("%s lets the release through as before", (_, repository, tag) => {
    const field = Object.keys(repository)[0];
    const pattern = Object.values(repository)[0];
    const former = new RegExp(pattern, "i").test(tag);

    expect({
      accepted: validateRegexInput(pattern),
      passes: passes(repository, tag),
    }).toEqual({
      accepted: null,
      passes: field === "includeRegex" ? former : !former,
    });
  });
});

describe("custom security patterns see the release text as JavaScript did", () => {
  it("\\s matches U+00A0 and U+FEFF, and CRLF stays two characters", () => {
    expect({
      nbsp: marks("/security\\sfix/i", "security\u00a0fix"),
      bom: marks("/security\\sfix/i", "security\ufefffix"),
      crlf: marks("/fix\\r\\nsecurity/", "fix\r\nsecurity"),
      twoSpaces: marks("/fix\\s\\ssecurity/", "fix\r\nsecurity"),
    }).toEqual({ nbsp: true, bom: true, crlf: true, twoSpaces: true });
  });

  it("multiline anchors end lines at CR, LF, U+2028 and U+2029, and see the empty line inside CRLF", () => {
    expect({
      heading: marks("/^## Security$/m", "## Changes\r\n## Security\r\n- XSS"),
      separator: marks("/^Security$/m", "Notes\u2028Security\u2029More"),
      insideCrlf: marks("/^$/m", "a\r\nb"),
      notALineEnd: marks("/^Security$/m", "Notes\u0085Security"),
    }).toEqual({
      heading: true,
      separator: true,
      insideCrlf: true,
      notALineEnd: false,
    });
  });

  it("groups read under multiline anchors keep the text's own line ends", () => {
    const pattern = compileUntrustedPattern("^(?<line>[^x]+)$", "m", {
      captures: true,
    }).pattern;

    expect({
      groups: pattern?.groups("a\r\nb"),
      javaScript: new RegExp(LINE_GROUP, "m").exec("a\r\nb")?.groups,
    }).toEqual({
      groups: { line: "a\r\nb" },
      javaScript: { line: "a\r\nb" },
    });
  });

  it("a multiline anchor together with a construct that tells line terminators apart is refused as unsupported", () => {
    expect({
      lineFeed: securityLineReason("/^## Security\\n/m"),
      carriageReturn: securityLineReason("/Security\\r$/m"),
      restOfLine: securityLineReason("/^Security[^\\n]*$/m"),
      lineFeedClass: securityLineReason("/^a[\\r\\n]b/m"),
      withoutAnchor: securityLineReason("/Security\\r\\n[^\\n]*/"),
      uniform: securityLineReason("/^\\s*Security[^x]*$/m"),
    }).toEqual({
      lineFeed: "unsupported",
      carriageReturn: "unsupported",
      restOfLine: "unsupported",
      lineFeedClass: "unsupported",
      withoutAnchor: null,
      uniform: null,
    });
  });
});

describe("version tag patterns whose groups RE2 would capture differently", () => {
  it("a named group inside a repeated group is refused, since JavaScript resets it in every iteration", () => {
    const pattern = "^v(?:(?<version>\\d+(?:\\.\\d+)*)-?)+$";

    expect({
      javaScript: new RegExp(RESET_GROUP).exec("1x")?.groups,
      quantified: versionReason(pattern),
      alternative: versionReason("^(?:(?<version>\\d+)|x)+$"),
      itself: versionReason("^v(?<version>\\d)+$"),
      validation: validateVersionTagPattern(pattern),
    }).toEqual({
      javaScript: { version: undefined },
      quantified: "unsupported",
      alternative: "unsupported",
      itself: "unsupported",
      validation: "invalid",
    });
  });

  it("a quantified group that can match the empty string is refused in a version tag pattern", () => {
    expect({
      optional: versionReason("^v(?<version>\\d*)?"),
      loop: versionReason("^(?:|v)*(?<version>v*\\d+)$"),
      javaScriptOptional: new RegExp(OPTIONAL_GROUP).exec("vx")?.groups,
    }).toEqual({
      optional: "unsupported",
      loop: "unsupported",
      javaScriptOptional: { version: undefined },
    });
  });

  it("keeps the documented and the usual version tag patterns, an optional revision included", () => {
    const patterns = [
      "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$",
      "^v(?<version>\\d+(?:\\.\\d+)*)$",
      "^(?<version>\\d+\\.\\d+\\.\\d+)(?:-r(?<revision>\\d+))?$",
      "^(?<version>\\d+)\\.(?<minor>\\d+)?",
      "(?<version>\\d*)",
    ];

    expect(patterns.map(validateVersionTagPattern)).toEqual(
      patterns.map(() => null),
    );
    expect(
      compileVersionTagPattern(
        "^(?<version>\\d+\\.\\d+\\.\\d+)(?:-r(?<revision>\\d+))?$",
      )?.groups("4.15.0-r12"),
    ).toEqual({ version: "4.15.0", revision: "12" });
  });

  it("the same constructs stay accepted in a filter, which only tests whether a tag matches", () => {
    expect({
      quantified: validateRegexInput("^v(?:(?<version>\\d+)-?)+$"),
      optional: validateRegexInput("^v(?<version>\\d*)?"),
    }).toEqual({ quantified: null, optional: null });
  });
});

describe("syntax JavaScript does not read is refused (no former meaning to keep)", () => {
  it("RE2's own syntax is refused as invalid; a Unicode property, a lone surrogate and a modifier group as unsupported", () => {
    expect({
      pythonGroup: versionReason("^v(?P<version>\\d+\\.\\d+)$"),
      inlineFlag: securityLineReason("/(?i)hardening/"),
      inlineFlagFilter: filterReason("(?i)\\pL{10}"),
      unicodeProperty: securityLineReason("/\\p{L}+-security/u"),
      loneSurrogate: filterReason("v1\ud800"),
      loneSurrogateValidation: validateRegexInput("v1\ud800"),
      modifier: securityLineReason("/(?i:hardening|[a-z]+-fix)/"),
      javaScriptModifier: new RegExp(MODIFIER_GROUP).test("B"),
    }).toEqual({
      pythonGroup: "invalid",
      inlineFlag: "invalid",
      inlineFlagFilter: "invalid",
      unicodeProperty: "unsupported",
      loneSurrogate: "unsupported",
      loneSurrogateValidation: "invalid",
      modifier: "unsupported",
      javaScriptModifier: false,
    });
  });
});

describe("\\u escapes", () => {
  it("an include or exclude filter caf\\u00e9 is saved and matches café and CAFÉ as JavaScript did", () => {
    const pattern = "caf\\u00e9";
    const current = createDefaultSettings();
    const tags = ["café-1.0", "CAFÉ-1.0", "cafe-1.0", "caf-1.0"];
    const former = tags.map((tag) => new RegExp(pattern, "i").test(tag));

    expect({
      validation: validateRegexInput(pattern),
      reason: filterReason(pattern),
      saved: [
        prepareSettingsUpdate({ includeRegex: pattern }, current, true).ok,
        prepareSettingsUpdate({ excludeRegex: pattern }, current, true).ok,
      ],
      include: tags.map((tag) => passes({ includeRegex: pattern }, tag)),
      exclude: tags.map((tag) => passes({ excludeRegex: pattern }, tag)),
    }).toEqual({
      validation: null,
      reason: null,
      saved: [true, true],
      include: former,
      exclude: former.map((matched) => !matched),
    });
    expect(former).toEqual([true, true, false, false]);
  });

  it("the built-in pattern for Sicherheitslücke is saved as a custom line and marks the texts JavaScript marks", () => {
    const line = "/\\bsicherheitsl(?:ue|\\u00fc)cke(?:n)?\\b/i";
    const texts = [
      "Behebt eine Sicherheitslücke.",
      "Zwei Sicherheitslücken geschlossen",
      "SICHERHEITSLUECKE",
      "Sicherheitslucke",
    ];
    const save = prepareSettingsUpdate(
      { customSecurityPatterns: `breaking\n${line}` },
      createDefaultSettings(),
      true,
    );
    const former = texts.map((text) =>
      /\bsicherheitsl(?:ue|\u00fc)cke(?:n)?\b/i.test(text),
    );

    expect({
      invalid: getInvalidCustomSecurityPattern(line),
      reason: securityLineReason(line),
      saved: save.ok,
      marks: texts.map((text) => marks(line, text)),
    }).toEqual({
      invalid: null,
      reason: null,
      saved: true,
      marks: former,
    });
    expect(former).toEqual([true, true, true, false]);
  });

  it("a version tag pattern with \\u escapes extracts the version JavaScript extracts", () => {
    const pattern = "^\\u0076(?<version>[\\u0030-\\u0039.]+)\\u002D?$";

    expect({
      validation: validateVersionTagPattern(pattern),
      groups: compileVersionTagPattern(pattern)?.groups("v1.2.3-"),
      javaScript: { ...new RegExp(pattern).exec("v1.2.3-")?.groups },
    }).toEqual({
      validation: null,
      groups: { version: "1.2.3" },
      javaScript: { version: "1.2.3" },
    });
  });

  it("refuses a \\u escape of a surrogate, one JavaScript reads as the letter u and \\u{…} without the u flag", () => {
    const current = createDefaultSettings();
    const filters = {
      pair: "^v\\ud83d\\ude00",
      high: "v\\ud83d",
      low: "\\udfff",
      pairInClass: "[\\ud83d\\ude00]",
      surrogateRange: "[\\ud800-\\udbff]",
      fewerDigits: "^v\\u12",
      bracesWithoutU: "^v\\u{2}",
      bracesInClassWithoutU: "^[\\u{41}]+$",
    };
    const lines = {
      pairWithU: "/\\ud83d\\ude00/u",
      surrogateWithU: "/\\u{d83d}/u",
      surrogateRangeWithU: "/[\\u{dc00}-\\u{dfff}]/u",
      moreThanSixDigits: "/\\u{0000041}/u",
      bracesWithoutU: "/\\u{2}/",
      aboveTheLastCodePoint: "/\\u{110000}/u",
      fewerDigitsWithU: "/\\u12/u",
    };

    expect({
      javaScript: [
        new RegExp(filters.fewerDigits, "i").test("vu12"),
        new RegExp(filters.bracesWithoutU, "i").test("vuu"),
        new RegExp(filters.bracesInClassWithoutU, "i").test("u{41}"),
      ],
      filters: Object.fromEntries(
        Object.entries(filters).map(([name, pattern]) => [
          name,
          [filterReason(pattern), validateRegexInput(pattern)],
        ]),
      ),
      lines: Object.fromEntries(
        Object.entries(lines).map(([name, line]) => [
          name,
          securityLineReason(line),
        ]),
      ),
      version: [
        versionReason("^v(?<version>\\d+)\\u{2}$"),
        validateVersionTagPattern("^v(?<version>\\d+)\\u{2}$"),
        validateVersionTagPattern("^v(?<version>\\d+)\\ud83d\\ude00$"),
      ],
      saved: [
        prepareSettingsUpdate({ includeRegex: "^v\\u{2}" }, current, true),
        prepareSettingsUpdate(
          { customSecurityPatterns: "/\\ud83d\\ude00/u" },
          current,
          true,
        ),
      ].map((result) => (result.ok ? null : result.errorKey)),
    }).toEqual({
      javaScript: [true, true, true],
      filters: Object.fromEntries(
        Object.keys(filters).map((name) => [name, ["unsupported", "invalid"]]),
      ),
      lines: {
        pairWithU: "unsupported",
        surrogateWithU: "unsupported",
        surrogateRangeWithU: "unsupported",
        moreThanSixDigits: "unsupported",
        bracesWithoutU: "unsupported",
        aboveTheLastCodePoint: "invalid",
        fewerDigitsWithU: "invalid",
      },
      version: ["unsupported", "invalid", "invalid"],
      saved: ["regex_error_invalid", "security_patterns_error_invalid"],
    });
  });
});

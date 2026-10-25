import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import {
  getInvalidCustomSecurityPattern,
  isSecurityRelease,
} from "@/lib/security-release";
import { validateRegexInput } from "@/lib/settings/form-model";
import { compileUntrustedPattern } from "@/lib/untrusted-pattern";

// Every pattern RE2 accepts matches as the former JavaScript evaluation did on
// real and generated corpora, except for case folding and non-BMP characters.

const MESSAGES = path.join(process.cwd(), "src", "messages");
const catalogs = readdirSync(MESSAGES)
  .filter((name) => name.endsWith(".json"))
  .map(
    (name) =>
      JSON.parse(readFileSync(path.join(MESSAGES, name), "utf8")) as Record<
        string,
        Record<string, string>
      >,
  );
const unquote = (message: string) => message.replaceAll("'", "");
const documented = {
  filters: [
    ...new Set(
      catalogs.map((catalog) =>
        catalog.SettingsForm.regex_placeholder.slice(
          catalog.SettingsForm.regex_placeholder.indexOf("^"),
        ),
      ),
    ),
  ],
  versions: [
    ...new Set(
      catalogs.map((catalog) =>
        unquote(catalog.RepoSettingsDialog.version_tag_pattern_placeholder),
      ),
    ),
  ],
  security: [
    ...new Set(
      catalogs.flatMap((catalog) =>
        unquote(
          catalog.SettingsForm.custom_security_patterns_placeholder,
        ).split("\n"),
      ),
    ),
  ],
};

const TAGS = [
  "v1.2.3",
  "1.2.3",
  "V1.2.3",
  "v1.2",
  "v10.0.0",
  "v1.2.3-rc.1",
  "v1.2.3-RC1",
  "v2.0.0-beta.2",
  "v2.0.0-alpha",
  "1.0.0rc1",
  "v1.2.3-dev",
  "v0.0.1-dev.20241001",
  "v1.2.3+build.5",
  "v1.2.3-SNAPSHOT",
  "docker/4.15.0-r0",
  "docker/4.15.0-r12",
  "docker/4.15.0.1-r3",
  "4.15.0",
  "release-2024-01-15",
  "nightly",
  "latest",
  "app@1.2.3",
  "@scope/pkg@2.0.0",
  "jellyfin-10.9.2",
  "1.2.3-ls446",
  "2.1.0-spt-4.0",
  "go1.22.3",
  "rel/v3.4",
  "2024.10.1",
  "Release_1_2",
  "pkg/1.2.3",
  "v1.2.3-ünïcode",
  "Überblick-1.0",
  "版本-1.2.3",
  "v3",
  "",
  "aaaa",
];

const FILTERS = [
  ...documented.filters,
  "^v",
  "-dev$",
  "^v\\d",
  "beta|rc|alpha",
  "^docker/",
  "\\d+\\.\\d+\\.\\d+$",
  "^release-\\d{4}-\\d{2}-\\d{2}$",
  "nightly|latest",
  "(?:alpha|beta)\\.\\d+",
  "^[0-9.]+$",
  "snapshot",
  "^v?\\d+(\\.\\d+){2}$",
  "ls\\d+",
  "^jellyfin-",
  "\\+build",
  "[._-]rc\\d*",
  "^go1\\.",
  "^[\\w@/.-]+@\\d",
  "^(v)?(\\d+)\\.(\\d+)$",
  "^V",
  "ü",
  "^.{5}$",
  "\\bv\\d\\b",
  "\\Bc\\d",
  "^\\S+$",
  "[^a-z0-9.]",
  "\\W",
  "a{2,}",
  "x{,3}",
  "(?:)",
  "^$",
  "v\\d+?",
  "\\/",
  "\\-dev",
  "[\\d-z]",
];

const VERSIONS = [
  ...documented.versions,
  "^v(?<version>\\d+\\.\\d+\\.\\d+)$",
  "^(?<version>\\d+\\.\\d+\\.\\d+)(?:-r(?<revision>\\d+))?$",
  "^jellyfin-(?<version>[\\d.]+)$",
  "(?<version>\\d+(?:\\.\\d+)*)",
  "^v?(?<version>.+?)(?:-r(?<revision>\\d+))?$",
  "^(?<version>\\d+)\\.(?<minor>\\d+)?",
  "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
  "^[^@]+@(?<version>.*)$",
  "(?<version>\\d*)",
  "^(?:docker|pkg)/(?<version>\\d+(?:\\.\\d+){2,3})(?:-r(?<revision>\\d+))?$",
];

const DEFAULT_SECURITY_PATTERNS = [
  /\bsecurity\b/i,
  /\bsecurity\s+(?:advisory|fix|patch|release|update)\b/i,
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bsicherheits(?:fix|patch|release|update)?\b/i,
  /\bsicherheitsl(?:ue|\u00fc)cke(?:n)?\b/i,
].map((pattern) => `/${pattern.source}/${pattern.flags}`);

const SECURITY_LINES = [
  ...documented.security,
  ...DEFAULT_SECURITY_PATTERNS,
  "/\\bsicherheitsl(?:ue|ü)cke(?:n)?\\b/i",
  "breaking",
  "Hardening",
  "a.b",
  "(xss)",
  "/hardening/i",
  "/XSS|RCE|SQLi/",
  "/priv(?:ilege)? esc/i",
  "/security.*fix/is",
  "/security.*fix/i",
  "/^## Security$/m",
  "/^BREAKING/m",
  "/fix(es)?\\s+#\\d+/gi",
  "/\\bCVE\\b/u",
  "/Sicherheitslücke/iu",
];

const RELEASES = [
  { name: "v1.2.3", tag_name: "v1.2.3", body: "Bug fixes only." },
  { name: "Security fix", tag_name: "v1.2.4", body: null },
  {
    name: "v2.0.0",
    tag_name: "v2.0.0",
    body: "## Changes\r\n## Security\r\n- XSS in the editor\r\n",
  },
  {
    name: "v2.0.1",
    tag_name: "v2.0.1",
    body: "## Security\n\nFixes CVE-2024-12345 and GHSA-abcd-1234-wxyz.",
  },
  { name: "BREAKING release", tag_name: "v3.0.0", body: "Breaking:\nfoo" },
  {
    name: "v3.0.1",
    tag_name: "v3.0.1",
    body: "BREAKING: removed the API\r\nSecurity hardening\r\nfix #12",
  },
  { name: "Auth Hardening", tag_name: "v3.1.0", body: "privilege esc fixed" },
  { name: "v3.2.0", tag_name: "v3.2.0", body: "security\r\nfix in the parser" },
  {
    name: "Sicherheitsupdate",
    tag_name: "v4.0.0",
    body: "Behebt eine Sicherheitslücke.",
  },
  { name: null, tag_name: "CVE-2025-0001", body: "" },
  { name: "Release a.b (xss)", tag_name: "v5", body: "Fixes #3 and #4" },
  { name: "Vulnerabilities fixed", tag_name: "v6", body: "SQLi, RCE" },
];

function formerSecurityMatch(
  line: string,
  release: (typeof RELEASES)[number],
): boolean {
  const text = [release.name, release.tag_name, release.body]
    .filter(Boolean)
    .join("\n");
  const literal = line.match(/^\/(.+)\/([a-z]*)$/i);
  const pattern = literal
    ? new RegExp(literal[1], literal[2])
    : new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  pattern.lastIndex = 0;
  return pattern.test(text);
}

describe("RE2 evaluates every supported pattern as the former JavaScript evaluation did", () => {
  it("every corpus pattern, the documented examples included, is supported", () => {
    expect({
      documented: [
        documented.filters.length,
        documented.versions.length,
        documented.security.length,
      ],
      filters: FILTERS.filter((pattern) => validateRegexInput(pattern)),
      versions: VERSIONS.filter(
        (pattern) => compileVersionTagPattern(pattern) === null,
      ),
      security: SECURITY_LINES.filter((line) =>
        getInvalidCustomSecurityPattern(line),
      ),
    }).toEqual({
      documented: [1, 1, 2],
      filters: [],
      versions: [],
      security: [],
    });
  });

  it("the include and exclude filters match the same tags", () => {
    const differences = FILTERS.flatMap((pattern) => {
      const re2 = compileUntrustedPattern(pattern, "i").pattern;
      const former = new RegExp(pattern, "i");
      return TAGS.filter((tag) => re2?.test(tag) !== former.test(tag)).map(
        (tag) => `${pattern} on ${tag}`,
      );
    });

    expect(FILTERS.length * TAGS.length).toBeGreaterThan(1000);
    expect(differences).toEqual([]);
  });

  it("the version tag patterns extract the same version and revision", () => {
    const differences = VERSIONS.flatMap((pattern) => {
      const re2 = compileVersionTagPattern(pattern);
      const former = new RegExp(pattern);
      return TAGS.filter((tag) => {
        const groups = former.exec(tag)?.groups ?? null;
        const extracted = re2?.groups(tag) ?? null;
        return (
          JSON.stringify(
            groups && [groups.version, groups.revision, groups.minor],
          ) !==
          JSON.stringify(
            extracted && [
              extracted.version,
              extracted.revision,
              extracted.minor,
            ],
          )
        );
      }).map((tag) => `${pattern} on ${tag}`);
    });

    expect(VERSIONS.length * TAGS.length).toBeGreaterThan(300);
    expect(differences).toEqual([]);
  });

  it("the custom security patterns mark the same releases", () => {
    const differences = SECURITY_LINES.flatMap((line) =>
      RELEASES.filter(
        (release) =>
          isSecurityRelease(release, {
            includeDefaultSecurityPatterns: false,
            customSecurityPatterns: line,
          }) !== formerSecurityMatch(line, release),
      ).map((release) => `${line} on ${release.tag_name}`),
    );

    const former = SECURITY_LINES.flatMap((line) =>
      RELEASES.map((release) => formerSecurityMatch(line, release)),
    );
    expect(former.filter(Boolean).length).toBeGreaterThan(30);
    expect(former.filter((matched) => !matched).length).toBeGreaterThan(30);
    expect(differences).toEqual([]);
  });
});

const FOLD_SPECIAL = [
  "\u212a",
  "\u017f",
  "\u1e9e",
  "\u212b",
  "\u2126",
  "\u03f4",
  "\u1fb3",
  "\u1fbc",
  "\u1f80",
  "\u1f88",
  "\u0390",
  "\u1fd3",
  "\u03b0",
  "\u1fe3",
  "\ufb05",
  "\ufb06",
];
const ASTRAL = ["\u{1f680}", "\u{10400}", "\u{10428}"];
const LONE_SURROGATES = ["\ud83d", "\ude80"];

const PLAIN = [
  ..."abkvsxKSV019",
  ..."._-/@+",
  ..."\t\n\v\f\r ",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2005",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
  "\u0085",
  "\u180e",
  "\u200b",
  ..."äÄßµσςΣθϑΘжЖıİåÅωΩéÉǄǅǆιΙ\u0345\u1fbe",
];

const isCaseInsensitive = (flags: string, source: string) =>
  flags.includes("i") || /\(\?[a-z]*i[a-z]*[-:]/.test(source);
const hasSurrogates = (text: string) => /[\ud800-\udfff]/.test(text);
const hasLoneSurrogate = (text: string) =>
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    text,
  );

function listedReason(
  source: string,
  flags: string,
  text: string,
  rangeCoversSpecial = false,
): string | null {
  if (
    isCaseInsensitive(flags, source) &&
    (rangeCoversSpecial ||
      FOLD_SPECIAL.some((char) => text.includes(char) || source.includes(char)))
  )
    return "case folding";
  if (hasLoneSurrogate(text)) return "lone surrogate";
  if (hasSurrogates(text) || (!flags.includes("u") && hasSurrogates(source)))
    return "outside the BMP";
  return null;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYNTAX = new Set([..."\\^$.|?*+()[]{}/"]);
const NAMED_ESCAPES: Record<string, string> = {
  "\t": "\\t",
  "\n": "\\n",
  "\v": "\\v",
  "\f": "\\f",
  "\r": "\\r",
};
const escapeChar = (char: string) =>
  NAMED_ESCAPES[char] ?? (SYNTAX.has(char) ? `\\${char}` : char);
const escapeClassChar = (char: string) =>
  char === "-" ? "\\-" : escapeChar(char);

type Generator = {
  rnd: () => number;
  chars: string[];
  names: number;
  rangeCoversSpecial: boolean;
};

function pick<T>(g: Generator, items: readonly T[]): T {
  return items[Math.floor(g.rnd() * items.length)];
}

function classItem(g: Generator): string {
  const r = g.rnd();
  if (r < 0.4) return escapeClassChar(pick(g, g.chars));
  if (r < 0.6) {
    const [low, high] = [pick(g, g.chars), pick(g, g.chars)].sort(
      (a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0),
    );
    const [lowCode, highCode] = [low, high].map(
      (char) => char.codePointAt(0) ?? 0,
    );
    if (
      FOLD_SPECIAL.some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return lowCode <= code && code <= highCode;
      })
    )
      g.rangeCoversSpecial = true;
    return `${escapeClassChar(low)}-${escapeClassChar(high)}`;
  }
  return pick(g, ["\\s", "\\S", "\\d", "\\D", "\\w", "\\W"]);
}

function atom(g: Generator, depth: number): { text: string; anchor: boolean } {
  const r = g.rnd();
  if (r < 0.32) return { text: escapeChar(pick(g, g.chars)), anchor: false };
  if (r < 0.5)
    return {
      text: pick(g, [".", "\\s", "\\S", "\\d", "\\D", "\\w", "\\W"]),
      anchor: false,
    };
  if (r < 0.64) {
    const items = Array.from({ length: 1 + Math.floor(g.rnd() * 3) }, () =>
      classItem(g),
    ).join("");
    return { text: `[${g.rnd() < 0.3 ? "^" : ""}${items}]`, anchor: false };
  }
  if (r < 0.74)
    return { text: pick(g, ["^", "$", "\\b", "\\B"]), anchor: true };
  if (depth >= 2) return { text: escapeChar(pick(g, g.chars)), anchor: false };
  const open = pick(g, [
    "(",
    "(?:",
    "(?:",
    `(?<g${g.names++}>`,
    "(?i:",
    "(?-i:",
    "(?m:",
    "(?s:",
  ]);
  return { text: `${open}${sequence(g, depth + 1, true)})`, anchor: false };
}

function sequence(g: Generator, depth: number, alternatives: boolean): string {
  const branch = () =>
    Array.from({ length: 1 + Math.floor(g.rnd() * 3) }, () => {
      const { text, anchor } = atom(g, depth);
      if (anchor || g.rnd() > 0.3) return text;
      const quantifier = pick(g, ["*", "+", "?", "{2}", "{0,2}", "{1,}"]);
      return `${text}${quantifier}${g.rnd() < 0.2 ? "?" : ""}`;
    }).join("");
  return alternatives && g.rnd() < 0.25 ? `${branch()}|${branch()}` : branch();
}

function text(rnd: () => number, chars: readonly string[]): string {
  return Array.from(
    { length: Math.floor(rnd() * 9) },
    () => chars[Math.floor(rnd() * chars.length)],
  ).join("");
}

const FLAGS = ["", "i", "m", "s", "u", "im", "is", "ms", "iu", "mu", "imsu"];

function jsTest(source: string, flags: string, input: string) {
  return new RegExp(source, flags).test(input);
}

describe("RE2 evaluates every accepted pattern as JavaScript, apart from the two listed differences", () => {
  it("the plain characters fold alike in both engines, and each listed character does not", () => {
    const sample = [...PLAIN, ...FOLD_SPECIAL];
    const disagree = (pattern: string, flags: string) => {
      const source = `^${escapeChar(pattern)}$`;
      const compiled = compileUntrustedPattern(source, flags).pattern;
      const javaScript = new RegExp(source, flags);
      return sample.filter(
        (char) => compiled?.test(char) !== javaScript.test(char),
      );
    };
    const plainDifferences = PLAIN.flatMap((pattern) =>
      ["i", "iu"].flatMap((flags) =>
        disagree(pattern, flags)
          .filter((char) => !FOLD_SPECIAL.includes(char))
          .map((char) => `${pattern} /${flags} on ${char}`),
      ),
    );
    const specialDifferences = new Set(
      sample.flatMap((pattern) => {
        const chars = disagree(pattern, "i");
        return FOLD_SPECIAL.includes(pattern) && chars.length > 0
          ? [pattern, ...chars]
          : chars;
      }),
    );
    const silentSpecial = FOLD_SPECIAL.filter(
      (special) => !specialDifferences.has(special),
    );

    expect({ plainDifferences, silentSpecial }).toEqual({
      plainDifferences: [],
      silentSpecial: [],
    });
  });

  it("., \\s, \\S and their classes match exactly JavaScript's characters on every BMP code unit", () => {
    const configurations: Array<[string, string]> = [
      [".", ""],
      [".", "s"],
      [".", "m"],
      [".", "u"],
      [".", "su"],
      ["\\s", ""],
      ["\\S", ""],
      ["\\s", "u"],
      ["\\S", "iu"],
      ["[\\s]", ""],
      ["[^\\s]", "i"],
      ["[\\S]", ""],
      ["[^\\S]", "u"],
      ["[\\sx]", ""],
      ["[^\\S\\d]", ""],
      ["[\\s\\S]", ""],
      ["[^.]", ""],
    ];
    const mismatches: string[] = [];
    for (const [pattern, flags] of configurations) {
      const source = `^${pattern}$`;
      const compiled = compileUntrustedPattern(source, flags).pattern;
      const javaScript = new RegExp(source, flags);
      if (!compiled) {
        mismatches.push(`${source} /${flags} refused`);
        continue;
      }
      for (let code = 0; code <= 0xffff; code++) {
        if (code >= 0xd800 && code <= 0xdfff) continue;
        const char = String.fromCharCode(code);
        if (compiled.test(char) !== javaScript.test(char))
          mismatches.push(`${source} /${flags} on U+${code.toString(16)}`);
      }
    }

    expect(mismatches.slice(0, 20)).toEqual([]);
  });

  it("generated patterns and texts: every difference on plain text is gone, the rest is listed", () => {
    const g: Generator = {
      rnd: random(20_261_019),
      chars: PLAIN,
      names: 0,
      rangeCoversSpecial: false,
    };
    const everything = [
      ...PLAIN,
      ...FOLD_SPECIAL,
      ...ASTRAL,
      ...LONE_SURROGATES,
    ];
    let accepted = 0;
    let compared = 0;
    let matched = 0;
    const unlisted: string[] = [];
    for (let round = 0; round < 1600; round++) {
      g.chars = round % 2 === 0 ? PLAIN : everything;
      g.rangeCoversSpecial = false;
      const source = sequence(g, 0, true);
      const flags = pick(g, FLAGS);
      try {
        new RegExp(source, flags);
      } catch {
        continue;
      }
      const compiled = compileUntrustedPattern(source, flags).pattern;
      if (!compiled) continue;
      accepted++;
      for (let index = 0; index < 24; index++) {
        const input = text(g.rnd, index % 2 === 0 ? PLAIN : everything);
        const expected = jsTest(source, flags, input);
        compared++;
        if (expected) matched++;
        if (
          compiled.test(input) !== expected &&
          !listedReason(source, flags, input, g.rangeCoversSpecial)
        )
          unlisted.push(
            `${JSON.stringify(source)} /${flags} on ${JSON.stringify(input)}: JavaScript ${expected}`,
          );
      }
    }

    expect({
      accepted: accepted > 500 || accepted,
      compared: compared > 12_000 || compared,
      matched: (matched > 1000 && compared - matched > 1000) || matched,
      unlisted: unlisted.slice(0, 20),
    }).toEqual({
      accepted: true,
      compared: true,
      matched: true,
      unlisted: [],
    });
  });

  it("generated version tag patterns extract the same named groups, apart from the listed differences", () => {
    const g: Generator = {
      rnd: random(1_019),
      chars: PLAIN,
      names: 0,
      rangeCoversSpecial: false,
    };
    const withListed = [...PLAIN, ...FOLD_SPECIAL, ...ASTRAL];
    let accepted = 0;
    let compared = 0;
    let withVersion = 0;
    const unlisted: string[] = [];
    const normalize = (groups: Record<string, string | undefined> | null) =>
      groups &&
      Object.fromEntries(
        Object.entries(groups).filter(([, value]) => value !== undefined),
      );
    for (let round = 0; round < 2400; round++) {
      g.names = 0;
      g.rangeCoversSpecial = false;
      const source =
        `${round % 2 === 0 ? "^" : ""}${sequence(g, 1, false)}(?<version>${sequence(g, 1, true)})${sequence(g, 1, false)}`.trim();
      try {
        new RegExp(source);
      } catch {
        continue;
      }
      const compiled = compileVersionTagPattern(source);
      if (!compiled) continue;
      accepted++;
      for (let index = 0; index < 24; index++) {
        const input = text(g.rnd, index % 3 === 0 ? withListed : PLAIN);
        const expected = normalize(
          new RegExp(source).exec(input)?.groups ?? null,
        );
        compared++;
        if (expected?.version) withVersion++;
        if (
          JSON.stringify(normalize(compiled.groups(input))) !==
            JSON.stringify(expected) &&
          !listedReason(source, "", input, g.rangeCoversSpecial)
        )
          unlisted.push(
            `${JSON.stringify(source)} on ${JSON.stringify(input)}: JavaScript ${JSON.stringify(expected)}`,
          );
      }
    }

    expect({
      accepted: accepted > 300 || accepted,
      compared: compared > 7000 || compared,
      withVersion: withVersion > 100 || withVersion,
      unlisted: unlisted.slice(0, 20),
    }).toEqual({
      accepted: true,
      compared: true,
      withVersion: true,
      unlisted: [],
    });
  });
});

describe("quantifiers of any length and word boundaries under `iu`", () => {
  it("a quantifier repeats as in JavaScript however many digits it has; one JavaScript reads as text stays text", () => {
    const zeros = (count: number) => "0".repeat(count);
    const sources = [0, 1, 29, 30, 31, 40, 200].flatMap((count) => [
      `^a{${zeros(count)}2}$`,
      `^a{${zeros(count)}2,}$`,
      `^a{1,${zeros(count)}3}$`,
      `^a{${zeros(count)}0,${zeros(count)}1}b$`,
    ]);
    sources.push("^a{,2}$", `^a{${zeros(40)}2$`, "^a{2,x}$");
    const inputs = ["", "a", "aa", "aaa", "aaaa", "b", "ab", "a{,2}", "a{2,x}"];
    let compared = 0;
    const differences: string[] = [];
    for (const source of sources)
      for (const flags of ["", "i", "m", "s"]) {
        const pattern = compileUntrustedPattern(source, flags).pattern;
        if (!pattern) {
          differences.push(`${source} /${flags} refused`);
          continue;
        }
        for (const input of inputs) {
          compared++;
          if (pattern.test(input) !== jsTest(source, flags, input))
            differences.push(`${source} /${flags} on ${input}`);
        }
      }

    expect({ compared, differences }).toEqual({
      compared: sources.length * 4 * inputs.length,
      differences: [],
    });
  });

  it("\\b and \\B are refused under `i` with `u`; under any other flags they agree with JavaScript on the long s and the Kelvin sign", () => {
    const sources = ["\\bx", "x\\b", "\\Bx", "x\\B", "\\b", "\\B", "[\\b]x"];
    const inputs = ["x", "ſx", "xſ", "Kx", "xK", "ax", " x"];
    const refused: string[] = [];
    const differences: string[] = [];
    for (const source of sources)
      for (const flags of FLAGS) {
        const result = compileUntrustedPattern(source, flags);
        const iu = flags.includes("i") && flags.includes("u");
        if (iu && !source.startsWith("[")) {
          if (result.error !== "unsupported")
            refused.push(`${source} /${flags}`);
          continue;
        }
        if (!result.pattern) {
          differences.push(`${source} /${flags} refused (${result.error})`);
          continue;
        }
        for (const input of inputs)
          if (result.pattern.test(input) !== jsTest(source, flags, input))
            differences.push(`${source} /${flags} on ${JSON.stringify(input)}`);
      }

    expect({ refused, differences }).toEqual({ refused: [], differences: [] });
  });
});

const ESCAPED_CHARS = [
  ..."vAz0_",
  ..."éÉüßµΣσж版",
  ..."\u00a0\u2028\u3000\ufeff\uffff\0\n\r",
  ..."()[]{}\\^$.|?*+-/",
];
const ESCAPED_RANGES: ReadonlyArray<readonly [string, string]> = [
  ["A", "Z"],
  ["a", "z"],
  ["0", "9"],
  ["\u00c0", "\u00d6"],
  ["\u00e0", "\u00fe"],
  ["\u00a0", "\u00ff"],
  ["\u03b1", "\u03c9"],
  ["\u0410", "\u044f"],
  ["\u2000", "\u202f"],
  ["[", "`"],
  [" ", "/"],
  ["\u7248", "\u7248"],
];
const ASTRAL_ESCAPED = ["\u{1f680}", "\u{1f600}", "\u{10400}", "\u{10428}"];
const ESCAPE_TEXTS = [
  ...new Set([
    ...ESCAPED_CHARS.flatMap((char) => [
      char,
      char.toUpperCase(),
      char.toLowerCase(),
      `x${char}y`,
      char.repeat(2),
    ]),
    ..."VZ9xμÀÖàþÞÿŸαωΩаяЯ\u2000\u202f\u2029` ",
    "café",
    "CAFÉ",
    "",
  ]),
];

const codePointHex = (char: string, width: number, upper: boolean) => {
  const digits = (char.codePointAt(0) ?? 0).toString(16).padStart(width, "0");
  return upper ? digits.toUpperCase() : digits;
};
const escape4 = (char: string, upper = false) =>
  `\\u${codePointHex(char, 4, upper)}`;
const escapeBraced = (char: string, width = 0, upper = false) =>
  `\\u{${codePointHex(char, width, upper)}}`;

function escapePatterns(
  chars: readonly string[],
  ranges: ReadonlyArray<readonly [string, string]>,
  escapeOf: (char: string, variant: number) => string,
): Array<[string, string]> {
  const literals = chars.flatMap((char, variant): Array<[string, string]> => {
    const escaped = escapeOf(char, variant);
    const written = escapeChar(char);
    const inClass = escapeClassChar(char);
    return [
      [`^${escaped}$`, `^${written}$`],
      [escaped, written],
      [`^${escaped}{2}$`, `^${written}{2}$`],
      [`^[${escaped}]$`, `^[${inClass}]$`],
      [`^[^${escaped}]$`, `^[^${inClass}]$`],
    ];
  });
  const classRanges = ranges.flatMap(
    ([low, high], variant): Array<[string, string]> => {
      const [escapedLow, escapedHigh] = [
        escapeOf(low, variant),
        escapeOf(high, variant + 1),
      ];
      const [writtenLow, writtenHigh] = [low, high].map(escapeClassChar);
      return [
        [
          `^[${escapedLow}-${escapedHigh}]+$`,
          `^[${writtenLow}-${writtenHigh}]+$`,
        ],
        [`[^${escapedLow}-${escapedHigh}]`, `[^${writtenLow}-${writtenHigh}]`],
        [
          `^[_${escapedLow}-${writtenHigh}x]$`,
          `^[_${writtenLow}-${writtenHigh}x]$`,
        ],
        [
          `^[${writtenLow}-${escapedHigh}]$`,
          `^[${writtenLow}-${writtenHigh}]$`,
        ],
      ];
    },
  );
  return [...literals, ...classRanges];
}

function compareEscapes(
  patterns: ReadonlyArray<readonly [string, string]>,
  flags: readonly string[],
  texts: readonly string[],
) {
  let accepted = 0;
  let compared = 0;
  let matched = 0;
  const differences: string[] = [];
  for (const [source, written] of patterns)
    for (const flag of flags) {
      let javaScript: RegExp;
      try {
        javaScript = new RegExp(source, flag);
      } catch {
        differences.push(`${JSON.stringify(source)} /${flag} not JavaScript`);
        continue;
      }
      const escaped = compileUntrustedPattern(source, flag);
      const writtenOut = compileUntrustedPattern(written, flag);
      if (escaped.error !== writtenOut.error) {
        differences.push(
          `${JSON.stringify(source)} /${flag}: ${escaped.error ?? "accepted"}, written out ${writtenOut.error ?? "accepted"}`,
        );
        continue;
      }
      if (!escaped.pattern) continue;
      accepted++;
      for (const text of texts) {
        const expected = javaScript.test(text);
        compared++;
        if (expected) matched++;
        if (escaped.pattern.test(text) !== expected)
          differences.push(
            `${JSON.stringify(source)} /${flag} on ${JSON.stringify(text)}: JavaScript ${expected}`,
          );
      }
    }
  return { accepted, compared, matched, differences };
}

describe("\\u escapes match the characters they name, as in JavaScript", () => {
  it("\\uXXXX as a literal, in a class and at the ends of a range, under every flag", () => {
    const patterns = escapePatterns(ESCAPED_CHARS, ESCAPED_RANGES, (char, n) =>
      escape4(char, n % 2 === 1),
    );
    const { accepted, compared, matched, differences } = compareEscapes(
      patterns,
      FLAGS,
      ESCAPE_TEXTS,
    );

    expect({
      accepted: accepted > patterns.length * FLAGS.length * 0.9 || accepted,
      compared: compared > 100_000 || compared,
      matched: (matched > 5000 && compared - matched > 5000) || matched,
      differences: differences.slice(0, 20),
    }).toEqual({
      accepted: true,
      compared: true,
      matched: true,
      differences: [],
    });
  });

  it("\\u{…} with the u flag, characters outside the BMP included", () => {
    const chars = [..."\0Av版(é", "\u2028", "\uffff", ...ASTRAL_ESCAPED];
    const ranges: ReadonlyArray<readonly [string, string]> = [
      ["A", "Z"],
      ["\u00e0", "\u00fe"],
      ["\u{1f600}", "\u{1f64f}"],
      ["\u{10400}", "\u{1044f}"],
      ["A", "\u{1f680}"],
    ];
    const patterns = [
      ...escapePatterns(chars, ranges, (char, n) =>
        n % 3 === 0
          ? escapeBraced(char)
          : n % 3 === 1
            ? escapeBraced(char, 6, true)
            : escapeBraced(char, 2),
      ),
      ["^[\\u0041-\\u{1f680}]$", "^[A-\u{1f680}]$"] as [string, string],
    ];
    const unicodeFlags = FLAGS.filter((flag) => flag.includes("u"));
    const texts = [
      ...ESCAPE_TEXTS,
      ...ASTRAL_ESCAPED.flatMap((char) => [char, `x${char}y`, char.repeat(2)]),
      "\u{1f64f}",
      "\u{1f650}",
      "\u{1044f}",
      "\u{10ffff}",
    ];
    const { accepted, compared, matched, differences } = compareEscapes(
      patterns,
      unicodeFlags,
      texts,
    );

    expect({
      accepted:
        accepted > patterns.length * unicodeFlags.length * 0.9 || accepted,
      compared: compared > 20_000 || compared,
      matched: (matched > 1000 && compared - matched > 1000) || matched,
      differences: differences.slice(0, 20),
    }).toEqual({
      accepted: true,
      compared: true,
      matched: true,
      differences: [],
    });
  });
});

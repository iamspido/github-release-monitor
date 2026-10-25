import { beforeAll, describe, expect, it } from "vitest";
import { bundleBounded, runBundled } from "../helpers/bounded-run";

// Patterns that backtrack for seconds to hours finish within two seconds in the
// real filter, selection, security, validation and import code, in a worker.

const TEST_TIMEOUT_MS = 60_000;

const NESTED_QUANTIFIER = "^(a+)+$";
const NESTED_VERSION_PATTERN = "^(?<version>(a+)+)$";
const RUN_LENGTHS = [20, 28, 40, 1000];
const failingTag = (length: number) => `${"a".repeat(length)}!`;
const EMPTY_STRING_BOMB = "(?<version>(?:a?|b?){40}\\b)";

const FILTER_SITE = `
  import {
    createEffectiveReleaseMatcher,
    resolveEffectiveRepoFilters,
  } from "@/lib/releases/filters";
  import type { AppSettings, Repository } from "@/types";
  async function run(input: { tag: string; repository: Partial<Repository> }) {
    const settings = {
      timeFormat: "24h",
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 0,
      releasesPerPage: 30,
      parallelRepoFetches: 1,
      releaseChannels: ["stable"],
    } as AppSettings;
    const filters = resolveEffectiveRepoFilters(input.repository, settings);
    const matches = createEffectiveReleaseMatcher(filters, "github:acme/tool");
    return matches({
      id: 1,
      html_url: "https://github.com/acme/tool/releases/tag/x",
      tag_name: input.tag,
      name: input.tag,
      body: null,
      created_at: "2026-10-01T00:00:00Z",
      published_at: "2026-10-01T00:00:00Z",
      prerelease: false,
      draft: false,
    });
  }
`;

const SELECTION_SITE = `
  import { getReleaseSelectionErrorType } from "@/lib/releases/selection";
  async function run(input: { tag: string; pattern: string }) {
    return getReleaseSelectionErrorType({
      releases: [
        {
          id: 1,
          html_url: "https://github.com/acme/tool/releases/tag/x",
          tag_name: input.tag,
          name: input.tag,
          body: null,
          created_at: "2026-10-01T00:00:00Z",
          published_at: "2026-10-01T00:00:00Z",
          prerelease: false,
          draft: false,
        },
      ],
      strategy: "highest_version",
      versionTagPattern: input.pattern,
    });
  }
`;

const SECURITY_SITE = `
  import { isSecurityRelease } from "@/lib/security-release";
  async function run(input: {
    release: { name: string | null; tag_name: string; body: string | null };
    customSecurityPatterns: string;
  }) {
    return isSecurityRelease(input.release, {
      includeDefaultSecurityPatterns: false,
      customSecurityPatterns: input.customSecurityPatterns,
    });
  }
`;

const VERSION_VALIDATION_SITE = `
  import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
  async function run(pattern: string) {
    return validateVersionTagPattern(pattern);
  }
`;

const VERSION_IMPORT_SITE = `
  import { parseImportedRepository } from "@/lib/repositories/repository-import";
  async function run(pattern: string) {
    return parseImportedRepository({
      url: "https://github.com/acme/tool",
      versionTagPattern: pattern,
    })?.versionTagPattern ?? null;
  }
`;

const bundles: Record<string, string> = {};

describe("patterns users enter run in linear time", () => {
  beforeAll(async () => {
    for (const [name, site] of Object.entries({
      filter: FILTER_SITE,
      selection: SELECTION_SITE,
      security: SECURITY_SITE,
      versionValidation: VERSION_VALIDATION_SITE,
      versionImport: VERSION_IMPORT_SITE,
    }))
      bundles[name] = await bundleBounded(site);
  }, TEST_TIMEOUT_MS * 2);

  it.each(RUN_LENGTHS)(
    "an include filter ^(a+)+$ answers within the deadline without a match for a tag of %i a's and a final !",
    async (length) => {
      const result = await runBundled<boolean>(bundles.filter, {
        tag: failingTag(length),
        repository: { includeRegex: NESTED_QUANTIFIER },
      });

      expect(result).toEqual({ finished: true, value: false });
    },
    TEST_TIMEOUT_MS,
  );

  it.each(RUN_LENGTHS)(
    "an exclude filter ^(a+)+$ answers within the deadline for a tag of %i a's and a final !",
    async (length) => {
      const result = await runBundled<boolean>(bundles.filter, {
        tag: failingTag(length),
        repository: { excludeRegex: NESTED_QUANTIFIER },
      });

      expect(result).toEqual({ finished: true, value: length < 255 });
    },
    TEST_TIMEOUT_MS,
  );

  it.each(RUN_LENGTHS)(
    "the version tag pattern classifies a tag of %i a's and a final ! within the deadline in the release filter",
    async (length) => {
      const result = await runBundled<boolean>(bundles.filter, {
        tag: failingTag(length),
        repository: {
          releaseSelectionStrategy: "highest_version",
          versionTagPattern: NESTED_VERSION_PATTERN,
        },
      });

      expect(result).toEqual({ finished: true, value: true });
    },
    TEST_TIMEOUT_MS,
  );

  it.each(RUN_LENGTHS)(
    "the version tag pattern selects among tags of %i a's and a final ! within the deadline",
    async (length) => {
      const result = await runBundled<string>(bundles.selection, {
        tag: failingTag(length),
        pattern: NESTED_VERSION_PATTERN,
      });

      expect(result).toEqual({
        finished: true,
        value: "no_matching_version_tags",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it.each(RUN_LENGTHS)(
    "a custom security pattern /^(a+)+$/ answers within the deadline without a match for a release named %i a's and a final !",
    async (length) => {
      const tag = failingTag(length);
      const result = await runBundled<boolean>(bundles.security, {
        release: { name: null, tag_name: tag, body: null },
        customSecurityPatterns: `/${NESTED_QUANTIFIER}/`,
      });

      expect(result).toEqual({ finished: true, value: false });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a custom security pattern reads a release body in linear time",
    async () => {
      const result = await runBundled<boolean>(bundles.security, {
        release: { name: "v1.0.0", tag_name: "v1.0.0", body: failingTag(40) },
        customSecurityPatterns: "/(a+)+$/",
      });

      expect(result).toEqual({ finished: true, value: false });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "saving a version tag pattern does not run it",
    async () => {
      const result = await runBundled<string | null>(
        bundles.versionValidation,
        EMPTY_STRING_BOMB,
      );

      expect(result).toEqual({ finished: true, value: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "importing a version tag pattern does not run it",
    async () => {
      const result = await runBundled<string | null>(
        bundles.versionImport,
        EMPTY_STRING_BOMB,
      );

      expect(result).toEqual({ finished: true, value: EMPTY_STRING_BOMB });
    },
    TEST_TIMEOUT_MS,
  );
});

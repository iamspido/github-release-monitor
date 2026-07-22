import type { EffectiveRepoFilters } from "@/lib/releases/filters";
import { createEffectiveReleaseMatcher } from "@/lib/releases/filters";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import type {
  FetchError,
  GithubRelease,
  ReleaseSelectionStrategy,
  Repository,
} from "@/types";
import { releaseSelectionStrategies } from "@/types";

type ParsedVersion = {
  core: bigint[];
  prerelease: Array<bigint | string>;
};

const VERSION_PATTERN =
  /^[vV]?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function normalizeReleaseSelectionStrategy(
  value: unknown,
): ReleaseSelectionStrategy {
  return releaseSelectionStrategies.includes(value as ReleaseSelectionStrategy)
    ? (value as ReleaseSelectionStrategy)
    : "newest";
}

export function resolveEffectiveReleaseSelectionStrategy(
  repository: Pick<Repository, "releaseSelectionStrategy">,
  globalStrategy: unknown,
): ReleaseSelectionStrategy {
  return repository.releaseSelectionStrategy
    ? normalizeReleaseSelectionStrategy(repository.releaseSelectionStrategy)
    : normalizeReleaseSelectionStrategy(globalStrategy);
}

function parseVersion(tagName: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(tagName.trim());
  if (!match) return null;

  return {
    core: match[1].split(".").map((component) => BigInt(component)),
    prerelease: match[2]
      ? match[2]
          .split(".")
          .map((identifier) =>
            /^\d+$/.test(identifier) ? BigInt(identifier) : identifier,
          )
      : [],
  };
}

function comparePrerelease(
  a: ParsedVersion["prerelease"],
  b: ParsedVersion["prerelease"],
): number {
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }

  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const aIdentifier = a[index];
    const bIdentifier = b[index];
    if (aIdentifier === undefined || bIdentifier === undefined) {
      if (aIdentifier === bIdentifier) return 0;
      return aIdentifier === undefined ? -1 : 1;
    }
    if (aIdentifier === bIdentifier) continue;
    if (typeof aIdentifier === "bigint" && typeof bIdentifier === "bigint") {
      return aIdentifier > bIdentifier ? 1 : -1;
    }
    if (typeof aIdentifier === "bigint") return -1;
    if (typeof bIdentifier === "bigint") return 1;
    if (aIdentifier !== bIdentifier) {
      return aIdentifier > bIdentifier ? 1 : -1;
    }
  }
  return 0;
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const aComponent = a.core[index] ?? BigInt(0);
    const bComponent = b.core[index] ?? BigInt(0);
    if (aComponent === bComponent) continue;
    return aComponent > bComponent ? 1 : -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function getReleaseTime(release: GithubRelease): number {
  const time = new Date(release.published_at || release.created_at).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function selectNewestRelease(releases: GithubRelease[]): GithubRelease {
  return releases.reduce((selected, release) =>
    getReleaseTime(release) > getReleaseTime(selected) ? release : selected,
  );
}

type VersionedRelease = {
  release: GithubRelease;
  version: ParsedVersion;
  revision: bigint;
};

function parseConfiguredVersion(
  release: GithubRelease,
  pattern: RegExp,
): VersionedRelease | null {
  const match = pattern.exec(release.tag_name);
  const versionValue = match?.groups?.version;
  if (!versionValue) return null;

  const version = parseVersion(versionValue);
  if (!version) return null;

  const revisionValue = match.groups?.revision;
  if (revisionValue !== undefined && !/^\d+$/.test(revisionValue)) return null;

  return {
    release,
    version,
    // A concrete revision zero is newer than the otherwise identical base
    // artifact, so an absent revision sorts immediately before r0.
    revision: revisionValue === undefined ? BigInt(-1) : BigInt(revisionValue),
  };
}

function getConfiguredVersionPattern(
  versionTagPattern: string | undefined,
): RegExp | null {
  const pattern = versionTagPattern?.trim();
  if (!pattern || validateVersionTagPattern(pattern)) return null;
  return new RegExp(pattern);
}

export function hasComparableVersionTag(
  releases: GithubRelease[],
  versionTagPattern: string | undefined,
): boolean {
  const hasConfiguredPattern = Boolean(versionTagPattern?.trim());
  const pattern = getConfiguredVersionPattern(versionTagPattern);
  if (hasConfiguredPattern && !pattern) return false;
  return pattern
    ? releases.some((release) => parseConfiguredVersion(release, pattern))
    : releases.some((release) => parseVersion(release.tag_name));
}

export function getReleaseSelectionErrorType(args: {
  releases: GithubRelease[];
  strategy: ReleaseSelectionStrategy;
  versionTagPattern: string | undefined;
}): FetchError["type"] {
  return args.strategy === "highest_version" &&
    args.versionTagPattern?.trim() &&
    !hasComparableVersionTag(args.releases, args.versionTagPattern)
    ? "no_matching_version_tags"
    : "no_matching_releases";
}

function selectHighestVersion(
  releases: GithubRelease[],
  versionTagPattern: string | undefined,
): GithubRelease | null {
  const hasConfiguredPattern = Boolean(versionTagPattern?.trim());
  const configuredPattern = getConfiguredVersionPattern(versionTagPattern);
  if (hasConfiguredPattern && !configuredPattern) return null;
  const versioned = releases.flatMap((release) => {
    if (hasConfiguredPattern && configuredPattern) {
      const candidate = parseConfiguredVersion(release, configuredPattern);
      return candidate ? [candidate] : [];
    }
    const version = parseVersion(release.tag_name);
    return version ? [{ release, version, revision: BigInt(-1) }] : [];
  });

  if (versioned.length === 0) {
    return hasConfiguredPattern ? null : selectNewestRelease(releases);
  }

  return versioned.reduce((selected, candidate) => {
    const comparison = compareVersions(candidate.version, selected.version);
    if (comparison > 0) return candidate;
    if (comparison === 0 && candidate.revision > selected.revision) {
      return candidate;
    }
    if (
      comparison === 0 &&
      candidate.revision === selected.revision &&
      getReleaseTime(candidate.release) > getReleaseTime(selected.release)
    ) {
      return candidate;
    }
    return selected;
  }).release;
}

export function selectMatchingRelease(args: {
  releases: GithubRelease[];
  filters: EffectiveRepoFilters;
  repoIdForLog: string;
  strategy: ReleaseSelectionStrategy;
  providerLatestRelease?: GithubRelease | null;
}): GithubRelease | null {
  const matchesRelease = createEffectiveReleaseMatcher(
    {
      ...args.filters,
      effectiveReleaseSelectionStrategy: args.strategy,
    },
    args.repoIdForLog,
  );

  if (args.strategy === "provider_latest") {
    return args.providerLatestRelease &&
      matchesRelease(args.providerLatestRelease)
      ? args.providerLatestRelease
      : null;
  }

  const filteredReleases = args.releases.filter(matchesRelease);
  if (filteredReleases.length === 0) return null;

  return args.strategy === "highest_version"
    ? selectHighestVersion(filteredReleases, args.filters.versionTagPattern)
    : selectNewestRelease(filteredReleases);
}

import type { EffectiveRepoFilters } from "@/lib/releases/filters";
import {
  createEffectiveReleaseMatcher,
  isPreReleaseByTagName,
} from "@/lib/releases/filters";
import {
  type ParsedVersion,
  parseComparableVersion,
} from "@/lib/releases/version";
import { validateVersionTagPattern } from "@/lib/releases/version-tag-pattern";
import type {
  FetchError,
  GithubRelease,
  ReleaseSelectionStrategy,
  Repository,
} from "@/types";
import { allPreReleaseTypes, releaseSelectionStrategies } from "@/types";

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

function compareVersionCore(a: ParsedVersion, b: ParsedVersion): number {
  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const aComponent = a.core[index] ?? BigInt(0);
    const bComponent = b.core[index] ?? BigInt(0);
    if (aComponent === bComponent) continue;
    return aComponent > bComponent ? 1 : -1;
  }
  return 0;
}

function splitNaturalIdentifier(
  identifier: bigint | string,
): Array<bigint | string> {
  if (typeof identifier === "bigint") return [identifier];
  return (identifier.match(/\d+|\D+/g) ?? [identifier]).map((part) =>
    /^\d+$/.test(part) ? BigInt(part) : part,
  );
}

function compareProductionSuffix(
  a: ParsedVersion["prerelease"],
  b: ParsedVersion["prerelease"],
): number {
  const aParts = a.flatMap(splitNaturalIdentifier);
  const bParts = b.flatMap(splitNaturalIdentifier);
  return comparePrerelease(aParts, bParts);
}

function getReleaseTime(release: GithubRelease): number {
  const time = new Date(release.published_at || release.created_at).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function getKnownReleaseTime(release: GithubRelease): number {
  return release.published_at_unknown
    ? Number.NEGATIVE_INFINITY
    : getReleaseTime(release);
}

function selectNewestRelease(releases: GithubRelease[]): GithubRelease {
  return releases.reduce((selected, release) =>
    getKnownReleaseTime(release) > getKnownReleaseTime(selected)
      ? release
      : selected,
  );
}

function selectNewestKnownRelease(
  releases: GithubRelease[],
): GithubRelease | null {
  const releasesWithKnownDates = releases.filter(
    (release) =>
      !release.published_at_unknown &&
      getReleaseTime(release) !== Number.NEGATIVE_INFINITY,
  );
  return releasesWithKnownDates.length > 0
    ? selectNewestRelease(releasesWithKnownDates)
    : null;
}

type VersionedRelease = {
  release: GithubRelease;
  version: ParsedVersion;
  revision: bigint;
  isProductionSuffix: boolean;
};

function isProductionSuffix(
  release: GithubRelease,
  version: ParsedVersion,
  versionValue: string,
  customPreReleaseMarkers: readonly string[],
): boolean {
  return (
    version.prerelease.length > 0 &&
    !release.prerelease &&
    !isPreReleaseByTagName(versionValue, allPreReleaseTypes) &&
    !isPreReleaseByTagName(versionValue, customPreReleaseMarkers)
  );
}

function compareVersionedReleases(
  a: VersionedRelease,
  b: VersionedRelease,
): number {
  const coreComparison = compareVersionCore(a.version, b.version);
  if (coreComparison !== 0) return coreComparison;

  if (a.isProductionSuffix || b.isProductionSuffix) {
    if (a.isProductionSuffix !== b.isProductionSuffix) {
      return a.isProductionSuffix ? 1 : -1;
    }
    return compareProductionSuffix(a.version.prerelease, b.version.prerelease);
  }

  return comparePrerelease(a.version.prerelease, b.version.prerelease);
}

function selectActiveVersionFamily(
  releases: VersionedRelease[],
): VersionedRelease[] | null {
  const families = new Map<
    string,
    { releases: VersionedRelease[]; latestTime: number }
  >();

  for (const candidate of releases) {
    const family = candidate.version.family;
    const candidateTime = getKnownReleaseTime(candidate.release);
    const existing = families.get(family);
    if (existing) {
      existing.releases.push(candidate);
      existing.latestTime = Math.max(existing.latestTime, candidateTime);
    } else {
      families.set(family, {
        releases: [candidate],
        latestTime: candidateTime,
      });
    }
  }

  const candidates = [...families.values()];
  let hasUnresolvedTie = false;
  const selected = candidates.reduce((current, candidate) => {
    if (candidate.latestTime !== current.latestTime) {
      if (candidate.latestTime > current.latestTime) {
        hasUnresolvedTie = false;
        return candidate;
      }
      return current;
    }
    if (candidate.releases.length !== current.releases.length) {
      if (candidate.releases.length > current.releases.length) {
        hasUnresolvedTie = false;
        return candidate;
      }
      return current;
    }
    hasUnresolvedTie = true;
    return current;
  });

  return hasUnresolvedTie ? null : selected.releases;
}

function parseConfiguredVersion(
  release: GithubRelease,
  pattern: RegExp,
  customPreReleaseMarkers: readonly string[] = [],
): VersionedRelease | null {
  const match = pattern.exec(release.tag_name);
  const versionValue = match?.groups?.version;
  if (!versionValue) return null;

  const version = parseComparableVersion(versionValue, customPreReleaseMarkers);
  if (!version) return null;

  const revisionValue = match.groups?.revision;
  if (revisionValue !== undefined && !/^\d+$/.test(revisionValue)) return null;

  return {
    release,
    version,
    // A concrete revision zero is newer than the otherwise identical base
    // artifact, so an absent revision sorts immediately before r0.
    revision:
      revisionValue === undefined ? version.revision : BigInt(revisionValue),
    isProductionSuffix: isProductionSuffix(
      release,
      version,
      versionValue,
      customPreReleaseMarkers,
    ),
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
  customPreReleaseMarkers: readonly string[] = [],
): boolean {
  const hasConfiguredPattern = Boolean(versionTagPattern?.trim());
  const pattern = getConfiguredVersionPattern(versionTagPattern);
  if (hasConfiguredPattern && !pattern) return false;
  return pattern
    ? releases.some((release) =>
        parseConfiguredVersion(release, pattern, customPreReleaseMarkers),
      )
    : releases.some((release) =>
        parseComparableVersion(release.tag_name, customPreReleaseMarkers),
      );
}

export function getReleaseSelectionErrorType(args: {
  releases: GithubRelease[];
  strategy: ReleaseSelectionStrategy;
  versionTagPattern: string | undefined;
  customPreReleaseMarkers?: readonly string[];
}): FetchError["type"] {
  return args.strategy === "highest_version" &&
    args.versionTagPattern?.trim() &&
    !hasComparableVersionTag(
      args.releases,
      args.versionTagPattern,
      args.customPreReleaseMarkers,
    )
    ? "no_matching_version_tags"
    : "no_matching_releases";
}

function selectHighestVersion(
  releases: GithubRelease[],
  versionTagPattern: string | undefined,
  customPreReleaseMarkers: readonly string[],
): GithubRelease | null {
  const hasConfiguredPattern = Boolean(versionTagPattern?.trim());
  const configuredPattern = getConfiguredVersionPattern(versionTagPattern);
  if (hasConfiguredPattern && !configuredPattern) return null;
  const versioned = releases.flatMap((release) => {
    if (hasConfiguredPattern && configuredPattern) {
      const candidate = parseConfiguredVersion(
        release,
        configuredPattern,
        customPreReleaseMarkers,
      );
      return candidate ? [candidate] : [];
    }
    const version = parseComparableVersion(
      release.tag_name,
      customPreReleaseMarkers,
    );
    return version
      ? [
          {
            release,
            version,
            revision: version.revision,
            isProductionSuffix: isProductionSuffix(
              release,
              version,
              release.tag_name,
              customPreReleaseMarkers,
            ),
          },
        ]
      : [];
  });

  if (versioned.length === 0) {
    return hasConfiguredPattern ? null : selectNewestKnownRelease(releases);
  }

  // Prefixes identify independent version families. The most recently active
  // family wins; versions from legacy or parallel tag schemes are not compared
  // numerically with it. When tag timestamps are identical placeholders, the
  // most represented family wins; an unresolved tie produces no selection.
  const comparableVersioned = hasConfiguredPattern
    ? versioned
    : selectActiveVersionFamily(versioned);
  if (!comparableVersioned) return null;

  return comparableVersioned.reduce((selected, candidate) => {
    const comparison = compareVersionedReleases(candidate, selected);
    if (comparison > 0) return candidate;
    if (comparison === 0 && candidate.revision > selected.revision) {
      return candidate;
    }
    if (
      comparison === 0 &&
      candidate.revision === selected.revision &&
      getKnownReleaseTime(candidate.release) >
        getKnownReleaseTime(selected.release)
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
  providerLatestIsStable?: boolean;
}): GithubRelease | null {
  const matchesRelease = createEffectiveReleaseMatcher(
    {
      ...args.filters,
      effectiveReleaseSelectionStrategy: args.strategy,
    },
    args.repoIdForLog,
    {
      forceStableChannel:
        args.strategy === "provider_latest" && args.providerLatestIsStable,
    },
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
    ? selectHighestVersion(
        filteredReleases,
        args.filters.versionTagPattern,
        args.filters.effectiveCustomPreReleaseMarkers,
      )
    : selectNewestRelease(filteredReleases);
}

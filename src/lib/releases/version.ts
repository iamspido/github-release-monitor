import {
  getValidCustomPreReleaseMarkers,
  normalizePreReleaseMarkerText,
} from "@/lib/releases/pre-release-markers";
import { allPreReleaseTypes } from "@/types";

export type ParsedVersion = {
  core: bigint[];
  prerelease: Array<bigint | string>;
  family: string;
  revision: bigint;
};

const VERSION_PATTERN =
  /^[vV]?(\d+(?:\.\d+){0,3})(?:-([\p{L}\p{M}0-9-]+(?:\.[\p{L}\p{M}0-9-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PREFIXED_MAJOR_VERSION_PATTERN =
  /^(.+?[._/-]v)(\d+)(?:-([\p{L}\p{M}0-9-]+(?:\.[\p{L}\p{M}0-9-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/iu;
const PREFIXED_VERSION_PATTERN =
  /^(.+?)(\d+(?:\.\d+){1,3})(?:-([\p{L}\p{M}0-9-]+(?:\.[\p{L}\p{M}0-9-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const compactPatternCache = new Map<
  string,
  { plain: RegExp; prefixed: RegExp }
>();
const maxCachedCompactPatterns = 100;

function getCompactPrereleasePatterns(customMarkers: readonly string[]) {
  const markers = getComparablePreReleaseMarkers(customMarkers);
  const key = markers.join("\0");
  const cached = compactPatternCache.get(key);
  if (cached) return cached;

  const alternatives = markers.map(escapeRegExp).join("|");
  const patterns = {
    plain: new RegExp(
      `^[vV]?(\\d+(?:\\.\\d+){1,3})(${alternatives})(\\d+)$`,
      "iu",
    ),
    prefixed: new RegExp(
      `^(.+?)(\\d+(?:\\.\\d+){1,3})(${alternatives})(\\d+)$`,
      "iu",
    ),
  };
  if (compactPatternCache.size >= maxCachedCompactPatterns) {
    const oldestKey = compactPatternCache.keys().next().value;
    if (oldestKey !== undefined) compactPatternCache.delete(oldestKey);
  }
  compactPatternCache.set(key, patterns);
  return patterns;
}

function getComparablePreReleaseMarkers(customMarkers: readonly string[]) {
  return [
    ...new Set([
      ...allPreReleaseTypes,
      ...getValidCustomPreReleaseMarkers(customMarkers),
    ]),
  ].sort((left, right) => right.length - left.length);
}

function parseCore(value: string): bigint[] {
  return value.split(".").map((component) => BigInt(component));
}

function parsePrerelease(
  value: string | undefined,
  family: string,
  markers: readonly string[],
): Pick<ParsedVersion, "prerelease" | "revision"> {
  if (!value) {
    return { prerelease: [], revision: BigInt(-1) };
  }

  const directMarkerPrerelease = parseMarkerIdentifier(value, markers);
  if (directMarkerPrerelease) {
    return {
      prerelease: directMarkerPrerelease,
      revision: BigInt(-1),
    };
  }

  const revisionMatch = /^(?:(.+)-)?r(\d+)$/i.exec(value);
  if (revisionMatch && (revisionMatch[1] || family)) {
    return {
      prerelease: revisionMatch[1]
        ? revisionMatch[1]
            .split(".")
            .flatMap((identifier) =>
              parsePreReleaseIdentifier(identifier, markers),
            )
        : [],
      revision: BigInt(revisionMatch[2]),
    };
  }

  return {
    prerelease: value
      .split(".")
      .flatMap((identifier) => parsePreReleaseIdentifier(identifier, markers)),
    revision: BigInt(-1),
  };
}

function parsePreReleaseIdentifier(
  identifier: string,
  markers: readonly string[],
): Array<bigint | string> {
  if (/^\d+$/.test(identifier)) return [BigInt(identifier)];

  return parseMarkerIdentifier(identifier, markers) ?? [identifier];
}

function parseMarkerIdentifier(
  identifier: string,
  markers: readonly string[],
): Array<bigint | string> | null {
  const normalizedIdentifier = normalizePreReleaseMarkerText(identifier);
  for (const marker of markers) {
    let markerIndex = normalizedIdentifier.indexOf(marker);
    while (markerIndex >= 0) {
      const prefix = normalizedIdentifier.slice(0, markerIndex);
      const hasBoundaryBefore =
        markerIndex === 0 || !/[\p{L}\p{M}]$/u.test(prefix);
      if (hasBoundaryBefore) {
        const remainder = normalizedIdentifier.slice(
          markerIndex + marker.length,
        );
        const revisionMatch = /^-?(\d+)$/.exec(remainder);
        if (remainder === "" || revisionMatch) {
          return [
            ...(prefix ? [prefix] : []),
            marker,
            ...(revisionMatch ? [BigInt(revisionMatch[1])] : []),
          ];
        }
      }
      markerIndex = normalizedIdentifier.indexOf(marker, markerIndex + 1);
    }
  }

  return null;
}

function isSafePrefix(prefix: string): boolean {
  // A digit directly following a separator would allow malformed versions such
  // as 1.2.3.4.5 or dated build tags to backtrack into a shorter suffix.
  // Embedded product digits such as api2-v1.4.0 remain unambiguous.
  return !/(?:^|[^A-Za-z0-9])\d/.test(prefix);
}

function looksLikeCalendarDate(value: string): boolean {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    year >= 1900 &&
    year <= 2999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

const datedActivityFamilies = new Set([
  "build",
  "nightly",
  "snapshot",
  "weekly",
]);

function isDatedActivityVersion(family: string, value: string): boolean {
  return datedActivityFamilies.has(family) && looksLikeCalendarDate(value);
}

function normalizeVersionFamily(prefix: string): string {
  return prefix
    .trim()
    .toLowerCase()
    .replace(/([._/-])v$/i, "$1")
    .replace(/[^a-z0-9]+$/g, "");
}

export function parseComparableVersion(
  tagName: string,
  customPreReleaseMarkers: readonly string[] = [],
): ParsedVersion | null {
  const trimmedTagName = tagName.trim();
  const markers = getComparablePreReleaseMarkers(customPreReleaseMarkers);
  const compactPatterns = getCompactPrereleasePatterns(customPreReleaseMarkers);
  const normalizedTagName = normalizePreReleaseMarkerText(trimmedTagName);
  const compactPrereleaseMatch = compactPatterns.plain.exec(normalizedTagName);
  if (compactPrereleaseMatch) {
    return {
      core: parseCore(compactPrereleaseMatch[1]),
      prerelease: [
        compactPrereleaseMatch[2].toLowerCase(),
        BigInt(compactPrereleaseMatch[3]),
      ],
      family: "",
      revision: BigInt(-1),
    };
  }

  const versionMatch = VERSION_PATTERN.exec(trimmedTagName);
  if (versionMatch) {
    const family = "";
    return {
      core: parseCore(versionMatch[1]),
      ...parsePrerelease(versionMatch[2], family, markers),
      family,
    };
  }

  const prefixedMajorMatch =
    PREFIXED_MAJOR_VERSION_PATTERN.exec(trimmedTagName);
  if (prefixedMajorMatch && isSafePrefix(prefixedMajorMatch[1])) {
    const family = normalizeVersionFamily(prefixedMajorMatch[1]);
    if (!family) return null;
    return {
      core: parseCore(prefixedMajorMatch[2]),
      ...parsePrerelease(prefixedMajorMatch[3], family, markers),
      family,
    };
  }

  const prefixedCompactMatch = compactPatterns.prefixed.exec(normalizedTagName);
  if (prefixedCompactMatch && isSafePrefix(prefixedCompactMatch[1])) {
    const family = normalizeVersionFamily(prefixedCompactMatch[1]);
    if (!family || isDatedActivityVersion(family, prefixedCompactMatch[2])) {
      return null;
    }
    return {
      core: parseCore(prefixedCompactMatch[2]),
      prerelease: [
        prefixedCompactMatch[3].toLowerCase(),
        BigInt(prefixedCompactMatch[4]),
      ],
      family,
      revision: BigInt(-1),
    };
  }

  const prefixedMatch = PREFIXED_VERSION_PATTERN.exec(trimmedTagName);
  if (!prefixedMatch || !isSafePrefix(prefixedMatch[1])) {
    return null;
  }
  const family = normalizeVersionFamily(prefixedMatch[1]);
  if (!family || isDatedActivityVersion(family, prefixedMatch[2])) return null;

  return {
    core: parseCore(prefixedMatch[2]),
    ...parsePrerelease(prefixedMatch[3], family, markers),
    family,
  };
}

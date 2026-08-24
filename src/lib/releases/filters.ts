import {
  getValidCustomPreReleaseMarkers,
  normalizePreReleaseMarkerText,
} from "@/lib/releases/pre-release-markers";
import { log } from "@/lib/server-action-helpers";
import type {
  AppSettings,
  CachedRelease,
  GithubRelease,
  PreReleaseChannelType,
  ReleaseSelectionStrategy,
  Repository,
} from "@/types";
import { allPreReleaseTypes, releaseSelectionStrategies } from "@/types";

const preReleaseMatcherCache = new Map<
  string,
  ReturnType<typeof createPreReleaseMatcher>
>();
const maxCachedPreReleaseMatchers = 100;
const builtInPreReleaseMarkerSet = new Set<string>(allPreReleaseTypes);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isPreReleaseByTagName(
  tagName: string,
  preReleaseMarkers?: readonly string[],
): boolean {
  if (typeof tagName !== "string" || !tagName) return false;

  // If no sub-channels are provided or the array is empty, it can't match anything.
  if (!preReleaseMarkers || preReleaseMarkers.length === 0) {
    return false;
  }

  const cacheKey = preReleaseMarkers.join("\0");
  let matcher = preReleaseMatcherCache.get(cacheKey);
  if (!matcher) {
    matcher = createPreReleaseMatcher(preReleaseMarkers);
    if (preReleaseMatcherCache.size >= maxCachedPreReleaseMatchers) {
      const oldestKey = preReleaseMatcherCache.keys().next().value;
      if (oldestKey !== undefined) preReleaseMatcherCache.delete(oldestKey);
    }
    preReleaseMatcherCache.set(cacheKey, matcher);
  }
  return matcher(tagName);
}

export function toCachedRelease(release: GithubRelease): CachedRelease {
  return {
    html_url: release.html_url,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    commit_links: release.commit_links,
    commit_links_resolved_at: release.commit_links_resolved_at,
    commit_links_retry: release.commit_links_retry,
    created_at: release.created_at,
    published_at: release.published_at,
    published_at_unknown: release.published_at_unknown,
    fetched_at: release.fetched_at,
    source: release.id === 0 ? "tag" : "release",
  };
}

export function toGithubReleaseFromCache(
  release: CachedRelease | undefined,
  fetchedAt?: string,
): GithubRelease | undefined {
  if (!release) return undefined;
  return {
    ...release,
    id: 0,
    prerelease: false,
    draft: false,
    ...(fetchedAt ? { fetched_at: fetchedAt } : {}),
  };
}

export function isCachedTagFallbackRelease(release?: CachedRelease): boolean {
  if (!release) return false;
  if (release.source === "tag") return true;
  return release.name === `Tag: ${release.tag_name}`;
}

export function canReplaceCachedReleaseWithVirtual(
  current: CachedRelease | undefined,
): boolean {
  return !current || isCachedTagFallbackRelease(current);
}

export function applyEtagUpdate(
  repository: Repository,
  newEtag: string | null | undefined,
): boolean {
  if (newEtag === undefined) return false;

  if (newEtag === null) {
    if (repository.etag === undefined) return false;
    delete repository.etag;
    return true;
  }

  if (repository.etag === newEtag) return false;
  repository.etag = newEtag;
  return true;
}

export function resolveParallelRepoFetches(settings: AppSettings): number {
  const raw = Number(settings.parallelRepoFetches);
  if (!Number.isFinite(raw)) {
    return 1;
  }
  const rounded = Math.round(raw);
  return Math.min(Math.max(rounded, 1), 50);
}

export function resolveEffectiveRepoFilters(
  repoSettings: Pick<
    Repository,
    | "releaseChannels"
    | "preReleaseSubChannels"
    | "customPreReleaseMarkers"
    | "releaseSelectionStrategy"
    | "versionTagPattern"
    | "releasesPerPage"
    | "includeRegex"
    | "excludeRegex"
    | "etag"
  >,
  globalSettings: AppSettings,
): {
  effectiveReleaseChannels: AppSettings["releaseChannels"];
  effectivePreReleaseSubChannels: PreReleaseChannelType[];
  effectiveCustomPreReleaseMarkers: string[];
  effectiveReleaseSelectionStrategy: ReleaseSelectionStrategy;
  versionTagPattern: string | undefined;
  totalReleasesToFetch: number;
  effectiveIncludeRegex: string | undefined;
  effectiveExcludeRegex: string | undefined;
} {
  const effectiveReleaseChannels =
    repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0
      ? repoSettings.releaseChannels
      : globalSettings.releaseChannels;

  const effectivePreReleaseSubChannels =
    repoSettings.preReleaseSubChannels ??
    globalSettings.preReleaseSubChannels ??
    allPreReleaseTypes;

  const effectiveCustomPreReleaseMarkers = getValidCustomPreReleaseMarkers(
    repoSettings.customPreReleaseMarkers === undefined
      ? globalSettings.customPreReleaseMarkers
      : repoSettings.customPreReleaseMarkers,
  ).filter((marker) => !builtInPreReleaseMarkerSet.has(marker));

  const totalReleasesToFetch =
    typeof repoSettings.releasesPerPage === "number" &&
    repoSettings.releasesPerPage >= 1 &&
    repoSettings.releasesPerPage <= 1000
      ? repoSettings.releasesPerPage
      : globalSettings.releasesPerPage;

  const releaseSelectionCandidate =
    repoSettings.releaseSelectionStrategy ??
    globalSettings.releaseSelectionStrategy;
  const effectiveReleaseSelectionStrategy = releaseSelectionStrategies.includes(
    releaseSelectionCandidate as ReleaseSelectionStrategy,
  )
    ? (releaseSelectionCandidate as ReleaseSelectionStrategy)
    : "newest";
  const versionTagPattern = repoSettings.versionTagPattern?.trim() || undefined;

  const effectiveIncludeRegex =
    repoSettings.includeRegex ?? globalSettings.includeRegex;
  const effectiveExcludeRegex =
    repoSettings.excludeRegex ?? globalSettings.excludeRegex;

  return {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    effectiveCustomPreReleaseMarkers,
    effectiveReleaseSelectionStrategy,
    versionTagPattern,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  };
}

export type EffectiveRepoFilters = ReturnType<
  typeof resolveEffectiveRepoFilters
>;

type ReleaseMatcher = (release: GithubRelease) => boolean;

function compileOptionalRegex(pattern: string | undefined): {
  regex?: RegExp;
  error?: unknown;
} {
  if (!pattern) return {};

  try {
    return { regex: new RegExp(pattern, "i") };
  } catch (error) {
    return { error };
  }
}

function createPreReleaseMatcher(
  preReleaseSubChannels: readonly string[],
): (tagName: string) => boolean {
  if (preReleaseSubChannels.length === 0) return () => false;

  const alternatives = preReleaseSubChannels.map((marker) => {
    const normalizedMarker = normalizePreReleaseMarkerText(marker);
    return `${escapeRegExp(normalizedMarker)}(?=[^\\p{L}\\p{M}]|$)`;
  });

  // Letters and combining marks cannot border a marker. Digits may precede a
  // marker in compact versions and may follow it as the release revision (for
  // example rc1).
  const regex = new RegExp(
    `(?:^|[^\\p{L}\\p{M}])(?:${alternatives.join("|")})`,
    "u",
  );
  return (tagName) => regex.test(normalizePreReleaseMarkerText(tagName));
}

export function createEffectiveReleaseMatcher(
  filters: EffectiveRepoFilters,
  repoIdForLog: string,
  options: { forceStableChannel?: boolean } = {},
): ReleaseMatcher {
  const exclude = compileOptionalRegex(filters.effectiveExcludeRegex);
  const include = compileOptionalRegex(filters.effectiveIncludeRegex);
  const matchesAnyPreReleaseChannel =
    createPreReleaseMatcher(allPreReleaseTypes);
  const matchesSelectedPreReleaseChannel = createPreReleaseMatcher(
    filters.effectivePreReleaseSubChannels,
  );
  const matchesCustomPreReleaseMarker = createPreReleaseMatcher(
    filters.effectiveCustomPreReleaseMarkers,
  );
  let versionTagPattern: RegExp | undefined;
  if (
    filters.effectiveReleaseSelectionStrategy === "highest_version" &&
    filters.versionTagPattern
  ) {
    try {
      versionTagPattern = new RegExp(filters.versionTagPattern);
    } catch {
      versionTagPattern = undefined;
    }
  }
  const loggedRegexErrors = new Set<unknown>();

  const logRegexErrorOnce = (error: unknown) => {
    if (loggedRegexErrors.has(error)) return;
    loggedRegexErrors.add(error);
    log.error(
      `Invalid regex for repo ${repoIdForLog}. Regex filters will be ignored. Error:`,
      error,
    );
  };

  return (release) => {
    if (exclude.error) {
      logRegexErrorOnce(exclude.error);
    } else if (exclude.regex?.test(release.tag_name)) {
      return false;
    }

    if (!exclude.error) {
      if (include.error) {
        logRegexErrorOnce(include.error);
      } else if (include.regex) {
        return include.regex.test(release.tag_name);
      }
    }

    if (release.draft) {
      return filters.effectiveReleaseChannels.includes("draft");
    }

    if (options.forceStableChannel) {
      return filters.effectiveReleaseChannels.includes("stable");
    }

    const extractedVersion = versionTagPattern?.exec(release.tag_name)?.groups
      ?.version;
    const versionForChannelClassification = (
      extractedVersion ?? release.tag_name
    ).trim();
    const isTagMarkedPreRelease = matchesAnyPreReleaseChannel(
      versionForChannelClassification,
    );
    const isCustomMarkedPreRelease = matchesCustomPreReleaseMarker(
      versionForChannelClassification,
    );
    // Unrecognized version suffixes may describe package revisions or target
    // platforms (for example -ls446 or -spt-4.0), not release channels.
    const isConsideredPreRelease =
      release.prerelease || isTagMarkedPreRelease || isCustomMarkedPreRelease;

    if (isConsideredPreRelease) {
      if (!filters.effectiveReleaseChannels.includes("prerelease")) {
        return false;
      }

      // If the tag explicitly includes a pre-release marker (e.g. -beta/-rc),
      // apply the configured sub-channel filter. Otherwise, fall back to the API flag.
      if (isCustomMarkedPreRelease) return true;

      if (isTagMarkedPreRelease) {
        return matchesSelectedPreReleaseChannel(
          versionForChannelClassification,
        );
      }

      return true;
    }

    return filters.effectiveReleaseChannels.includes("stable");
  };
}

export function releaseMatchesEffectiveFilters(
  release: GithubRelease,
  filters: EffectiveRepoFilters,
  repoIdForLog: string,
): boolean {
  return createEffectiveReleaseMatcher(filters, repoIdForLog)(release);
}

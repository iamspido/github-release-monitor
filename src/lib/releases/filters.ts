import { log } from "@/lib/server-action-helpers";
import type {
  AppSettings,
  CachedRelease,
  GithubRelease,
  PreReleaseChannelType,
  Repository,
} from "@/types";
import { allPreReleaseTypes } from "@/types";

export function isPreReleaseByTagName(
  tagName: string,
  preReleaseSubChannels?: PreReleaseChannelType[],
): boolean {
  if (typeof tagName !== "string" || !tagName) return false;

  // If no sub-channels are provided or the array is empty, it can't match anything.
  if (!preReleaseSubChannels || preReleaseSubChannels.length === 0) {
    return false;
  }

  // This regex looks for a non-letter boundary, then one of the keywords.
  // The (?=[^a-zA-Z]|$) lookahead asserts the next character is NOT a letter
  // (or the end of the string), preventing matches like `beta` in `betamax`.
  // This matches `-b3`, `v1.0-beta`, `v1.0rc1`, and `release_candidate_1.0rc2`.
  const preReleaseRegex = new RegExp(
    `(?:^|[^a-zA-Z])(${preReleaseSubChannels.join("|")})(?=[^a-zA-Z]|$)`,
    "i",
  );
  return preReleaseRegex.test(tagName);
}

export function toCachedRelease(release: GithubRelease): CachedRelease {
  return {
    html_url: release.html_url,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    created_at: release.created_at,
    published_at: release.published_at,
    published_at_unknown: release.published_at_unknown,
    fetched_at: release.fetched_at,
    source: release.id === 0 ? "tag" : "release",
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
    | "releasesPerPage"
    | "includeRegex"
    | "excludeRegex"
    | "etag"
  >,
  globalSettings: AppSettings,
): {
  effectiveReleaseChannels: AppSettings["releaseChannels"];
  effectivePreReleaseSubChannels: PreReleaseChannelType[];
  totalReleasesToFetch: number;
  effectiveIncludeRegex: string | undefined;
  effectiveExcludeRegex: string | undefined;
} {
  const effectiveReleaseChannels =
    repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0
      ? repoSettings.releaseChannels
      : globalSettings.releaseChannels;

  const preReleaseSubChannelCandidate =
    repoSettings.preReleaseSubChannels &&
    repoSettings.preReleaseSubChannels.length > 0
      ? repoSettings.preReleaseSubChannels
      : globalSettings.preReleaseSubChannels;

  const effectivePreReleaseSubChannels =
    preReleaseSubChannelCandidate && preReleaseSubChannelCandidate.length > 0
      ? preReleaseSubChannelCandidate
      : allPreReleaseTypes;

  const totalReleasesToFetch =
    typeof repoSettings.releasesPerPage === "number" &&
    repoSettings.releasesPerPage >= 1 &&
    repoSettings.releasesPerPage <= 1000
      ? repoSettings.releasesPerPage
      : globalSettings.releasesPerPage;

  const effectiveIncludeRegex =
    repoSettings.includeRegex ?? globalSettings.includeRegex;
  const effectiveExcludeRegex =
    repoSettings.excludeRegex ?? globalSettings.excludeRegex;

  return {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  };
}

export type EffectiveRepoFilters = ReturnType<
  typeof resolveEffectiveRepoFilters
>;

export function releaseMatchesEffectiveFilters(
  release: GithubRelease,
  filters: EffectiveRepoFilters,
  repoIdForLog: string,
): boolean {
  try {
    if (filters.effectiveExcludeRegex) {
      const exclude = new RegExp(filters.effectiveExcludeRegex, "i");
      if (exclude.test(release.tag_name)) return false;
    }
    if (filters.effectiveIncludeRegex) {
      const include = new RegExp(filters.effectiveIncludeRegex, "i");
      return include.test(release.tag_name);
    }
  } catch (error) {
    log.error(
      `Invalid regex for repo ${repoIdForLog}. Regex filters will be ignored. Error:`,
      error,
    );
  }

  if (release.draft) {
    return filters.effectiveReleaseChannels.includes("draft");
  }

  const isTagMarkedPreRelease = isPreReleaseByTagName(
    release.tag_name,
    allPreReleaseTypes,
  );
  const isConsideredPreRelease = release.prerelease || isTagMarkedPreRelease;

  if (isConsideredPreRelease) {
    if (!filters.effectiveReleaseChannels.includes("prerelease")) return false;

    // If the tag explicitly includes a pre-release marker (e.g. -beta/-rc),
    // apply the configured sub-channel filter. Otherwise, fall back to the API flag.
    if (isTagMarkedPreRelease) {
      return isPreReleaseByTagName(
        release.tag_name,
        filters.effectivePreReleaseSubChannels,
      );
    }

    return true;
  }

  return filters.effectiveReleaseChannels.includes("stable");
}

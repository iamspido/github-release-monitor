import {
  type EffectiveRepoFilters,
  releaseMatchesEffectiveFilters,
} from "@/lib/releases/filters";
import type { LatestReleaseFetchResult } from "@/lib/releases/types";
import { log } from "@/lib/server-action-helpers";
import type { GithubRelease } from "@/types";

export function resolvePageCount(
  totalItemsToFetch: number,
  maxPerPage: number,
) {
  return Math.ceil(totalItemsToFetch / maxPerPage);
}

export function resolvePageSize(args: {
  maxPerPage: number;
  totalItemsToFetch: number;
  alreadyFetched: number;
}) {
  return Math.min(
    args.maxPerPage,
    args.totalItemsToFetch - args.alreadyFetched,
  );
}

export function notModifiedResult(
  providerRepoId: string,
  etag: string | undefined,
): LatestReleaseFetchResult {
  log.info(`[ETag] No changes for ${providerRepoId}.`);
  return {
    release: null,
    error: { type: "not_modified" },
    newEtag: etag,
  };
}

export function selectFirstMatchingRelease<
  T extends { release: GithubRelease },
>(candidates: T[], filters: EffectiveRepoFilters, repoIdForLog: string) {
  return candidates.find(({ release }) =>
    releaseMatchesEffectiveFilters(release, filters, repoIdForLog),
  );
}

export function selectLatestMatchingRelease(args: {
  releases: GithubRelease[];
  filters: EffectiveRepoFilters;
  repoIdForLog: string;
}) {
  const filteredReleases = args.releases.filter((release) =>
    releaseMatchesEffectiveFilters(release, args.filters, args.repoIdForLog),
  );

  if (filteredReleases.length === 0) {
    return null;
  }

  return filteredReleases.slice().sort((a, b) => {
    const aTime = new Date(a.published_at || a.created_at).getTime();
    const bTime = new Date(b.published_at || b.created_at).getTime();
    return bTime - aTime;
  })[0];
}

import {
  applyEtagUpdate,
  canReplaceCachedReleaseWithVirtual,
  toCachedRelease,
} from "@/lib/releases/filters";
import type { EnrichedRelease, Repository } from "@/types";

type ApplyReleaseFetchResultOptions = {
  initializeLastSeenFromFetchedRelease?: boolean;
};

export function applyReleaseFetchResultToRepository(
  repository: Repository,
  enrichedRelease: Pick<EnrichedRelease, "release" | "error" | "newEtag">,
  options: ApplyReleaseFetchResultOptions = {},
): boolean {
  let changed = applyEtagUpdate(repository, enrichedRelease.newEtag);

  if (!enrichedRelease.release) {
    return changed;
  }

  const isReconstructed = enrichedRelease.error?.type === "not_modified";
  const newCachedRelease = toCachedRelease(enrichedRelease.release);

  if (
    !isReconstructed ||
    canReplaceCachedReleaseWithVirtual(repository.latestRelease)
  ) {
    if (
      JSON.stringify(repository.latestRelease) !==
      JSON.stringify(newCachedRelease)
    ) {
      changed = true;
    }
    repository.latestRelease = newCachedRelease;
  } else if (repository.latestRelease && newCachedRelease.fetched_at) {
    if (repository.latestRelease.fetched_at !== newCachedRelease.fetched_at) {
      repository.latestRelease.fetched_at = newCachedRelease.fetched_at;
      changed = true;
    }
  }

  if (
    options.initializeLastSeenFromFetchedRelease &&
    !repository.lastSeenReleaseTag &&
    !isReconstructed
  ) {
    repository.lastSeenReleaseTag = enrichedRelease.release.tag_name;
    changed = true;
  }

  return changed;
}

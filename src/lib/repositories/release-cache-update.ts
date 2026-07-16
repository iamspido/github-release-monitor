import {
  applyEtagUpdate,
  canReplaceCachedReleaseWithVirtual,
  toCachedRelease,
} from "@/lib/releases/filters";
import type { EnrichedRelease, Repository } from "@/types";

type ApplyReleaseFetchResultOptions = {
  initializeLastSeenFromRealRelease?: boolean;
};

export function applyReleaseFetchResultToRepository(
  repository: Repository,
  enrichedRelease: Pick<EnrichedRelease, "release" | "newEtag">,
  options: ApplyReleaseFetchResultOptions = {},
): boolean {
  let changed = applyEtagUpdate(repository, enrichedRelease.newEtag);

  if (!enrichedRelease.release) {
    return changed;
  }

  const isVirtual = enrichedRelease.release.id === 0;
  const newCachedRelease = toCachedRelease(enrichedRelease.release);

  if (
    !isVirtual ||
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
    options.initializeLastSeenFromRealRelease &&
    !repository.lastSeenReleaseTag &&
    !isVirtual
  ) {
    repository.lastSeenReleaseTag = enrichedRelease.release.tag_name;
    changed = true;
  }

  return changed;
}

import { toGithubReleaseFromCache } from "@/lib/releases/filters";
import { toRepositorySettingsSnapshot } from "@/lib/repositories/settings-snapshot";
import type { EnrichedRelease, Repository } from "@/types";

export function toCachedEnrichedRelease(
  repository: Repository,
): EnrichedRelease {
  return {
    repoId: repository.id,
    repoUrl: repository.url,
    release: toGithubReleaseFromCache(repository.latestRelease),
    isNew: repository.isNew,
    repoSettings: toRepositorySettingsSnapshot(repository),
    // No fetch happens here, so the persisted ETag remains unchanged.
    newEtag: repository.etag,
  };
}

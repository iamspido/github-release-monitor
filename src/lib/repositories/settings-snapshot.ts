import type { EnrichedRelease, Repository } from "@/types";

export function toRepositorySettingsSnapshot(
  repository: Repository,
): NonNullable<EnrichedRelease["repoSettings"]> {
  return {
    displayName: repository.displayName,
    isPinned: repository.isPinned,
    releaseChannels: repository.releaseChannels,
    preReleaseSubChannels: repository.preReleaseSubChannels,
    customPreReleaseMarkers: repository.customPreReleaseMarkers,
    releaseSelectionStrategy: repository.releaseSelectionStrategy,
    versionTagPattern: repository.versionTagPattern,
    releasesPerPage: repository.releasesPerPage,
    refreshInterval: repository.refreshInterval,
    cacheInterval: repository.cacheInterval,
    backgroundCheckCron: repository.backgroundCheckCron,
    includeRegex: repository.includeRegex,
    excludeRegex: repository.excludeRegex,
    appriseTags: repository.appriseTags,
    appriseFormat: repository.appriseFormat,
  };
}

import type { FetchError, GithubRelease, Repository } from "@/types";

export type RepoSettingsForFetch = Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "customPreReleaseMarkers"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
  | "releasesPerPage"
  | "cacheInterval"
  | "includeRegex"
  | "excludeRegex"
  | "etag"
  | "latestRelease"
>;

export type LatestReleaseFetchResult = {
  release: GithubRelease | null;
  error: FetchError | null;
  newEtag?: string | null;
};

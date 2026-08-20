import type { EffectiveRepoFilters } from "@/lib/releases/filters";
import {
  getReleaseSelectionErrorType,
  selectMatchingRelease,
} from "@/lib/releases/selection";
import type { LatestReleaseFetchResult } from "@/lib/releases/types";
import { log } from "@/lib/server-action-helpers";
import type {
  FetchError,
  GithubRelease,
  ReleaseSelectionStrategy,
} from "@/types";

type CommitMetadata = {
  message?: string;
  date?: string;
};

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

export function releaseErrorResult(
  type: FetchError["type"],
  newEtag?: string | null,
): LatestReleaseFetchResult {
  return { release: null, error: { type }, newEtag };
}

export function releaseSuccessResult(
  release: GithubRelease,
  newEtag: string | null | undefined,
  fetchedAt: string,
): LatestReleaseFetchResult {
  release.fetched_at = fetchedAt;
  return { release, error: null, newEtag };
}

export function buildFallbackMarkdown(title: string, message: string): string {
  return `### ${title}\n\n---\n\n${message}`;
}

export function applyCommitMetadata(
  release: GithubRelease,
  metadata: CommitMetadata | null,
  fallbackTitle: string,
  options: { replaceBody?: boolean } = {},
): void {
  if (
    metadata?.message &&
    (options.replaceBody || !release.body || release.body.trim() === "")
  ) {
    release.body = buildFallbackMarkdown(fallbackTitle, metadata.message);
  }

  if (!metadata?.date) return;
  if (release.published_at_unknown) {
    release.created_at = metadata.date;
    release.published_at = metadata.date;
    release.published_at_unknown = false;
    return;
  }

  release.published_at = release.published_at ?? metadata.date;
}

export function selectLatestMatchingRelease(args: {
  releases: GithubRelease[];
  filters: EffectiveRepoFilters;
  repoIdForLog: string;
  strategy?: ReleaseSelectionStrategy;
  providerLatestRelease?: GithubRelease | null;
  providerLatestIsStable?: boolean;
}) {
  return selectMatchingRelease({
    ...args,
    strategy: args.strategy ?? "newest",
  });
}

export function resolveReleaseSelectionErrorType(args: {
  releases: GithubRelease[];
  filters: EffectiveRepoFilters;
  strategy: ReleaseSelectionStrategy;
}): FetchError["type"] {
  return getReleaseSelectionErrorType({
    releases: args.releases,
    strategy: args.strategy,
    versionTagPattern: args.filters.versionTagPattern,
    customPreReleaseMarkers: args.filters.effectiveCustomPreReleaseMarkers,
  });
}

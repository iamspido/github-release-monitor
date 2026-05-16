import type {
  EnrichedRelease,
  ReleaseProviderSortKey,
  ReleaseSortOrder,
} from "@/types";
import {
  defaultProviderSortOrder,
  releaseSortOrders,
  repoProviderSortKeys,
} from "@/types";

function getReleaseTime(release: EnrichedRelease): number | null {
  const date = release.release?.published_at || release.release?.created_at;
  if (!date) return null;

  const time = new Date(date).getTime();
  return Number.isNaN(time) ? null : time;
}

export function normalizeReleaseSortOrder(value: unknown): ReleaseSortOrder {
  return releaseSortOrders.includes(value as ReleaseSortOrder)
    ? (value as ReleaseSortOrder)
    : "latest_first";
}

export function normalizeProviderSortOrder(
  value: unknown,
): ReleaseProviderSortKey[] {
  if (!Array.isArray(value)) return [...defaultProviderSortOrder];

  const configured = value.filter((entry): entry is ReleaseProviderSortKey =>
    repoProviderSortKeys.includes(entry as ReleaseProviderSortKey),
  );

  return [
    ...configured,
    ...defaultProviderSortOrder.filter((entry) => !configured.includes(entry)),
  ];
}

export function getRepoProviderSortKey(
  repoId: string,
): ReleaseProviderSortKey | "unknown" {
  const provider = repoId.includes(":")
    ? repoId.slice(0, repoId.indexOf(":")).toLowerCase()
    : "github";

  return repoProviderSortKeys.includes(provider as ReleaseProviderSortKey)
    ? (provider as ReleaseProviderSortKey)
    : "unknown";
}

function getRepoNameSortKey(repoId: string): string {
  const provider = getRepoProviderSortKey(repoId);
  const path = repoId.includes(":")
    ? repoId.slice(repoId.indexOf(":") + 1)
    : repoId;

  if (provider === "gitlab") {
    const segments = path.split("/");
    const firstSegment = segments[0];
    const includesGitlabHost =
      segments.length >= 3 &&
      (firstSegment === "localhost" ||
        firstSegment.includes(".") ||
        firstSegment.includes(":"));

    return includesGitlabHost ? segments.slice(1).join("/") : path;
  }

  return path;
}

function compareByLatestRelease(a: EnrichedRelease, b: EnrichedRelease) {
  const aTime = getReleaseTime(a);
  const bTime = getReleaseTime(b);

  if (aTime === null && bTime === null) {
    return a.repoId.localeCompare(b.repoId);
  }
  if (aTime === null) return 1;
  if (bTime === null) return -1;

  const diff = bTime - aTime;
  return diff === 0 ? a.repoId.localeCompare(b.repoId) : diff;
}

function compareByOldestRelease(a: EnrichedRelease, b: EnrichedRelease) {
  const aTime = getReleaseTime(a);
  const bTime = getReleaseTime(b);

  if (aTime === null && bTime === null) {
    return a.repoId.localeCompare(b.repoId);
  }
  if (aTime === null) return 1;
  if (bTime === null) return -1;

  const diff = aTime - bTime;
  return diff === 0 ? a.repoId.localeCompare(b.repoId) : diff;
}

function compareByProvider(
  providerSortOrder: ReleaseProviderSortKey[],
  a: EnrichedRelease,
  b: EnrichedRelease,
) {
  const normalizedProviderSortOrder =
    normalizeProviderSortOrder(providerSortOrder);
  const providerRank = new Map<string, number>(
    normalizedProviderSortOrder.map((provider, index) => [provider, index]),
  );
  const unknownRank = normalizedProviderSortOrder.length;
  const aRank =
    providerRank.get(getRepoProviderSortKey(a.repoId)) ?? unknownRank;
  const bRank =
    providerRank.get(getRepoProviderSortKey(b.repoId)) ?? unknownRank;

  if (aRank !== bRank) return aRank - bRank;

  return compareByLatestRelease(a, b);
}

export function sortEnrichedReleases(
  releases: EnrichedRelease[],
  sortOrder: ReleaseSortOrder | undefined,
  providerSortOrder: ReleaseProviderSortKey[] | undefined,
): EnrichedRelease[] {
  const normalizedSortOrder = normalizeReleaseSortOrder(sortOrder);

  return [...releases].sort((a, b) => {
    switch (normalizedSortOrder) {
      case "new_first":
        if (Boolean(a.isNew) !== Boolean(b.isNew)) {
          return a.isNew ? -1 : 1;
        }
        return compareByLatestRelease(a, b);
      case "oldest_first":
        return compareByOldestRelease(a, b);
      case "repo_az":
        return getRepoNameSortKey(a.repoId).localeCompare(
          getRepoNameSortKey(b.repoId),
        );
      case "repo_za":
        return getRepoNameSortKey(b.repoId).localeCompare(
          getRepoNameSortKey(a.repoId),
        );
      case "provider_grouped":
        return compareByProvider(
          providerSortOrder ?? defaultProviderSortOrder,
          a,
          b,
        );
      default:
        return compareByLatestRelease(a, b);
    }
  });
}

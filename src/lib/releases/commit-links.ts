import { remark } from "remark";
import remarkGfm from "remark-gfm";

import type { CachedRelease, CommitLink, GithubRelease } from "@/types";

const COMMIT_LINK_RETRY_BASE_MS = 15 * 60 * 1000;
const COMMIT_LINK_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const COMMIT_LINK_RETRY_MAX_ATTEMPTS = 8;
const COMMIT_LINK_CONTINUATION_DELAY_MS = 60 * 1000;
const COMMIT_LINK_RESOLUTION_TTL_MS = 24 * 60 * 60 * 1000;
const COMMIT_LINK_ENRICHMENT_TIMEOUT_MS = 5_000;
const COMMIT_LINK_RESOLUTION_CONCURRENCY = 4;
const COMMIT_LINK_CANDIDATES_PER_ATTEMPT = 50;
const COMMIT_LINK_CANDIDATES_PER_RELEASE = 100;

const commitRefPattern = /(?<![0-9a-z_@#])([0-9a-f]{7,40})(?![0-9a-z_])/gi;
const commitCandidateParser = remark().use(remarkGfm);
const ignoredCommitCandidateNodeTypes = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
]);
const ignoredRawHtmlContainerPattern = /<\s*(\/?)\s*(a|code|pre)\b[^>]*>/gi;

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function updateIgnoredRawHtmlContainers(
  value: string,
  containers: string[],
): void {
  if (value.trimStart().startsWith("<!--")) return;

  for (const match of value.matchAll(ignoredRawHtmlContainerPattern)) {
    const tagName = match[2].toLowerCase();
    if (match[1]) {
      const index = containers.lastIndexOf(tagName);
      if (index >= 0) containers.splice(index);
    } else if (!/\/\s*>$/.test(match[0])) {
      containers.push(tagName);
    }
  }
}

function collectCommitRefCandidates(
  node: MarkdownNode,
  candidates: Set<string>,
): void {
  if (
    candidates.size >= COMMIT_LINK_CANDIDATES_PER_RELEASE ||
    ignoredCommitCandidateNodeTypes.has(node.type)
  ) {
    return;
  }

  if (node.type === "text" && node.value) {
    for (const match of node.value.matchAll(commitRefPattern)) {
      candidates.add(match[1].toLowerCase());
      if (candidates.size >= COMMIT_LINK_CANDIDATES_PER_RELEASE) return;
    }
  }

  const ignoredRawHtmlContainers: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type === "html") {
      if (child.value) {
        updateIgnoredRawHtmlContainers(child.value, ignoredRawHtmlContainers);
      }
      continue;
    }
    if (ignoredRawHtmlContainers.length === 0) {
      collectCommitRefCandidates(child, candidates);
    }
    if (candidates.size >= COMMIT_LINK_CANDIDATES_PER_RELEASE) return;
  }
}

export function findCommitRefCandidates(markdown: string): string[] {
  const candidates = new Set<string>();
  const tree = commitCandidateParser.parse(markdown) as MarkdownNode;
  collectCommitRefCandidates(tree, candidates);
  return [...candidates];
}

function isCommitLinkRetryDue(
  release: Pick<GithubRelease | CachedRelease, "commit_links_retry">,
  now = Date.now(),
): boolean {
  const retryAt = release.commit_links_retry?.retry_at;
  if (!retryAt) return true;
  const retryTimestamp = Date.parse(retryAt);
  return !Number.isFinite(retryTimestamp) || retryTimestamp <= now;
}

function clearCommitLinkRetry(release: GithubRelease): void {
  delete release.commit_links_retry;
}

function setResolvedCommitLinks(
  release: GithubRelease,
  commitLinks: CommitLink[],
): void {
  release.commit_links = commitLinks;
  release.commit_links_resolved_at = new Date().toISOString();
  clearCommitLinkRetry(release);
}

function isCommitLinkResolutionFresh(
  release: Pick<
    GithubRelease | CachedRelease,
    "commit_links" | "commit_links_resolved_at"
  >,
  now = Date.now(),
): boolean {
  if (release.commit_links === undefined) return false;
  const resolvedAt = release.commit_links_resolved_at;
  if (!resolvedAt) return false;
  const resolvedTimestamp = Date.parse(resolvedAt);
  return (
    Number.isFinite(resolvedTimestamp) &&
    resolvedTimestamp <= now &&
    resolvedTimestamp > now - COMMIT_LINK_RESOLUTION_TTL_MS
  );
}

export function canReuseCommitLinkState(
  release: Pick<
    GithubRelease | CachedRelease,
    "body" | "commit_links" | "commit_links_resolved_at" | "commit_links_retry"
  >,
): boolean {
  const candidates = release.body ? findCommitRefCandidates(release.body) : [];
  if (candidates.length === 0) return true;
  if (release.commit_links_retry) return !isCommitLinkRetryDue(release);
  return isCommitLinkResolutionFresh(release);
}

function setPendingCommitLinks(
  release: GithubRelease,
  commitLinks: CommitLink[],
  retry: NonNullable<GithubRelease["commit_links_retry"]>,
): void {
  if (commitLinks.length > 0) {
    release.commit_links = commitLinks;
  } else {
    delete release.commit_links;
  }
  delete release.commit_links_resolved_at;
  release.commit_links_retry = retry;
}

function scheduleCommitLinkRetry(
  release: GithubRelease,
  commitLinks: CommitLink[],
  checkedRefs: string[],
): void {
  const attempts = Math.min(
    (release.commit_links_retry?.attempts ?? 0) + 1,
    COMMIT_LINK_RETRY_MAX_ATTEMPTS,
  );
  const delayMs = Math.min(
    COMMIT_LINK_RETRY_BASE_MS * 2 ** (attempts - 1),
    COMMIT_LINK_RETRY_MAX_MS,
  );
  setPendingCommitLinks(release, commitLinks, {
    attempts,
    retry_at: new Date(Date.now() + delayMs).toISOString(),
    ...(checkedRefs.length > 0 ? { checked_refs: checkedRefs } : {}),
  });
}

function scheduleCommitLinkContinuation(
  release: GithubRelease,
  commitLinks: CommitLink[],
  checkedRefs: string[],
): void {
  setPendingCommitLinks(release, commitLinks, {
    attempts: 0,
    retry_at: new Date(
      Date.now() + COMMIT_LINK_CONTINUATION_DELAY_MS,
    ).toISOString(),
    checked_refs: checkedRefs,
  });
}

export function inheritCommitLinkState(
  release: GithubRelease,
  cachedRelease: CachedRelease | undefined,
): void {
  if (
    cachedRelease === undefined ||
    cachedRelease.html_url !== release.html_url ||
    cachedRelease.tag_name !== release.tag_name ||
    cachedRelease.body !== release.body
  ) {
    return;
  }

  if (cachedRelease.commit_links !== undefined) {
    release.commit_links = cachedRelease.commit_links.map((link) => ({
      ...link,
    }));
    release.commit_links_resolved_at = cachedRelease.commit_links_resolved_at;
  }
  if (cachedRelease.commit_links_retry) {
    release.commit_links_retry = { ...cachedRelease.commit_links_retry };
    if (cachedRelease.commit_links_retry.checked_refs) {
      release.commit_links_retry.checked_refs = [
        ...cachedRelease.commit_links_retry.checked_refs,
      ];
    }
  } else if (cachedRelease.commit_links !== undefined) {
    clearCommitLinkRetry(release);
  }
}

export type CommitLinkCandidateResult =
  | { status: "resolved"; link: CommitLink }
  | { status: "not_found" }
  | { status: "retry" };

export type CommitLinkResolution = {
  links: CommitLink[];
  checkedRefs: string[];
  complete: boolean;
};

export async function resolveCommitLinkCandidates(args: {
  candidates: readonly string[];
  deadline: number;
  resolve: (
    ref: string,
    deadline: number,
  ) => Promise<CommitLinkCandidateResult>;
  concurrency?: number;
  maxCandidates?: number;
}): Promise<CommitLinkResolution> {
  const maxCandidates = Math.max(
    1,
    Math.floor(args.maxCandidates ?? COMMIT_LINK_CANDIDATES_PER_ATTEMPT),
  );
  const candidates = args.candidates.slice(0, maxCandidates);
  const concurrency = Math.max(
    1,
    Math.floor(args.concurrency ?? COMMIT_LINK_RESOLUTION_CONCURRENCY),
  );
  const results = new Array<CommitLink | null>(candidates.length);
  const checked = new Array<boolean>(candidates.length).fill(false);
  let nextIndex = 0;
  let halted = false;

  async function worker(): Promise<void> {
    while (!halted && nextIndex < candidates.length) {
      if (Date.now() >= args.deadline) {
        halted = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const result = await args.resolve(candidates[index], args.deadline);
      if (result.status === "retry") {
        halted = true;
        return;
      }
      checked[index] = true;
      results[index] = result.status === "resolved" ? result.link : null;
    }
  }

  const workerCount = Math.min(concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const checkedRefs = candidates.filter((_candidate, index) => checked[index]);
  return {
    links: results.filter((link): link is CommitLink => link !== null),
    checkedRefs,
    complete:
      args.candidates.length <= maxCandidates &&
      checkedRefs.length === candidates.length,
  };
}

export async function applyVerifiedCommitLinks(args: {
  release: GithubRelease;
  resolve: (
    candidates: readonly string[],
    deadline: number,
  ) => Promise<CommitLinkResolution | null>;
}): Promise<void> {
  const { release } = args;
  const candidates = release.body ? findCommitRefCandidates(release.body) : [];

  if (candidates.length === 0) {
    release.commit_links = [];
    delete release.commit_links_resolved_at;
    clearCommitLinkRetry(release);
    return;
  }

  if (isCommitLinkResolutionFresh(release)) {
    clearCommitLinkRetry(release);
    return;
  }

  if (!isCommitLinkRetryDue(release)) return;

  const candidateSet = new Set(candidates);
  const existingLinks = (release.commit_links ?? []).filter((link) =>
    candidateSet.has(link.ref),
  );
  const checkedRefs = new Set(
    release.commit_links_retry?.checked_refs?.filter((ref) =>
      candidateSet.has(ref),
    ) ?? [],
  );
  const previousCheckedRefCount = checkedRefs.size;
  const uncheckedCandidates = candidates.filter((ref) => !checkedRefs.has(ref));
  if (uncheckedCandidates.length === 0) {
    setResolvedCommitLinks(release, existingLinks);
    return;
  }

  const deadline = Date.now() + COMMIT_LINK_ENRICHMENT_TIMEOUT_MS;
  let resolution: CommitLinkResolution | null = null;
  try {
    resolution = await args.resolve(uncheckedCandidates, deadline);
  } catch {
    resolution = null;
  }

  if (resolution === null) {
    scheduleCommitLinkRetry(release, existingLinks, [...checkedRefs]);
    return;
  }

  const linksByRef = new Map(
    existingLinks.map((link) => [link.ref, link] as const),
  );
  for (const ref of resolution.checkedRefs) linksByRef.delete(ref);
  for (const link of resolution.links) linksByRef.set(link.ref, link);
  for (const ref of resolution.checkedRefs) checkedRefs.add(ref);
  const links = candidates.flatMap((ref) => {
    const link = linksByRef.get(ref);
    return link ? [link] : [];
  });
  const complete =
    resolution.complete && candidates.every((ref) => checkedRefs.has(ref));
  if (complete) {
    setResolvedCommitLinks(release, links);
  } else if (checkedRefs.size > previousCheckedRefCount) {
    scheduleCommitLinkContinuation(release, links, [...checkedRefs]);
  } else {
    scheduleCommitLinkRetry(release, links, [...checkedRefs]);
  }
}

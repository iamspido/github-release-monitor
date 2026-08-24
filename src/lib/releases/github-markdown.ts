import { findCommitRefCandidates } from "@/lib/releases/commit-links";
import type { CommitLink } from "@/types";

const commitAnchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const commitHrefPattern = /\bhref\s*=\s*(["'])([^"']+)\1/i;
const htmlTagPattern = /<!--[\s\S]*?-->|<[^>]*>/g;
const releaseBodyStartPattern =
  /<div\b(?=[^>]*\bdata-test-selector\s*=\s*["']body-content["'])[^>]*>/i;

export function findGithubCommitRefCandidates(markdown: string): string[] {
  return findCommitRefCandidates(markdown);
}

export function extractGithubReleaseBodyHtml(pageHtml: string): string | null {
  const openingTag = releaseBodyStartPattern.exec(pageHtml);
  if (!openingTag || openingTag.index === undefined) return null;

  const bodyStart = openingTag.index + openingTag[0].length;
  const divTokenPattern = /<!--[\s\S]*?-->|<\/?div\b[^>]*>/gi;
  divTokenPattern.lastIndex = bodyStart;
  let depth = 1;

  for (const token of pageHtml.matchAll(divTokenPattern)) {
    const tokenIndex = token.index;
    if (
      tokenIndex === undefined ||
      tokenIndex < bodyStart ||
      token[0].startsWith("<!--")
    ) {
      continue;
    }
    if (/^<\/div\b/i.test(token[0])) {
      depth -= 1;
      if (depth === 0) {
        return pageHtml.slice(bodyStart, tokenIndex);
      }
    } else {
      depth += 1;
    }
  }

  return null;
}

type RenderedGithubCommitLink = {
  refs: Set<string>;
  sha: string;
};

function extractRenderedGithubCommitLinks(
  renderedHtml: string,
  owner: string,
  repo: string,
): RenderedGithubCommitLink[] {
  const links: RenderedGithubCommitLink[] = [];

  for (const anchor of renderedHtml.matchAll(commitAnchorPattern)) {
    try {
      const href = commitHrefPattern.exec(anchor[1]);
      if (!href) continue;
      const url = new URL(
        href[2].replaceAll("&amp;", "&"),
        "https://github.com",
      );
      if (url.protocol !== "https:" || url.hostname !== "github.com") continue;

      const segments = url.pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment));
      if (
        segments.length !== 4 ||
        segments[0].toLowerCase() !== owner.toLowerCase() ||
        segments[1].toLowerCase() !== repo.toLowerCase() ||
        segments[2] !== "commit" ||
        !/^[0-9a-f]{40}$/i.test(segments[3])
      ) {
        continue;
      }

      const sha = segments[3].toLowerCase();
      const visibleText = anchor[2].replace(htmlTagPattern, " ");
      const refs = new Set(
        findGithubCommitRefCandidates(visibleText).filter((ref) =>
          sha.startsWith(ref),
        ),
      );
      links.push({ refs, sha });
    } catch {
      // Ignore malformed links in the rendered response.
    }
  }

  return links;
}

export function resolveGithubCommitLinks(
  markdown: string,
  renderedHtml: string,
  owner: string,
  repo: string,
): CommitLink[] {
  const candidates = findGithubCommitRefCandidates(markdown);
  if (candidates.length === 0) return [];

  const renderedLinks = extractRenderedGithubCommitLinks(
    renderedHtml,
    owner,
    repo,
  );
  const links: CommitLink[] = [];
  for (const candidate of candidates) {
    const matchingShas = new Set(
      renderedLinks
        .filter(
          ({ refs, sha }) =>
            (candidate.length === 40 && sha === candidate) ||
            refs.has(candidate),
        )
        .map(({ sha }) => sha),
    );
    if (matchingShas.size === 1) {
      const sha = [...matchingShas][0];
      links.push({
        ref: candidate,
        sha,
        url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${sha}`,
      });
    }
  }
  return links;
}

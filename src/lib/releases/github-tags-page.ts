export type GithubTagsPageEntry = {
  name: string;
  commitSha: string;
  updatedAt: string;
};

const MAX_TAGS_PAGE_LENGTH = 2_000_000;

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function parseGithubTagsPage(html: string): GithubTagsPageEntry[] {
  if (!html || html.length > MAX_TAGS_PAGE_LENGTH) {
    return [];
  }

  const entries: GithubTagsPageEntry[] = [];
  const tagLinkPattern =
    /<a\b[^>]*href=["']\/[^/"']+\/[^/"']+\/releases\/tag\/([^"']+)["'][^>]*>/gi;
  const matches = [...html.matchAll(tagLinkPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? html.length;
    const tagBlock = html.slice(start, end);
    const dateMatch = tagBlock.match(
      /<relative-time\b[^>]*datetime=["']([^"']+)["']/i,
    );
    const commitMatch = tagBlock.match(
      /href=["']\/[^/"']+\/[^/"']+\/commit\/([0-9a-f]{40,64})["']/i,
    );

    try {
      const name = decodeURIComponent(decodeHtmlAttribute(match[1]));
      const updatedAt = dateMatch?.[1]?.trim();
      const commitSha = commitMatch?.[1];
      if (
        !name ||
        !updatedAt ||
        !commitSha ||
        !Number.isFinite(new Date(updatedAt).getTime())
      ) {
        continue;
      }

      entries.push({ name, commitSha, updatedAt });
    } catch {
      // Ignore malformed percent-encoding in a tag URL.
    }
  }

  return entries;
}

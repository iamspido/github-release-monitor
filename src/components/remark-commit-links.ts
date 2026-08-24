import type { CommitLink } from "@/types";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

type CommitLinkOptions = {
  commitLinks?: readonly CommitLink[];
};

const commitHashPattern = /(?<![0-9a-z_@#])([0-9a-f]{7,40})(?![0-9a-z_])/gi;
const ignoredRawHtmlContainerPattern = /<\s*(\/?)\s*(a|code|pre)\b[^>]*>/gi;

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

function linkCommitHashes(
  value: string,
  commitLinks: ReadonlyMap<string, string>,
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(commitHashPattern)) {
    const index = match.index;
    const hash = match[1];
    if (index === undefined || !hash) continue;
    const commitUrl = commitLinks.get(hash.toLowerCase());
    if (!commitUrl) continue;

    if (index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, index) });
    }
    nodes.push({
      type: "link",
      url: commitUrl,
      children: [{ type: "inlineCode", value: hash.slice(0, 7) }],
    });
    cursor = index + hash.length;
  }

  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }

  return nodes;
}

function transformChildren(
  node: MarkdownNode,
  commitLinks: ReadonlyMap<string, string>,
): void {
  if (node.type === "link" || node.type === "linkReference" || !node.children) {
    return;
  }

  const ignoredRawHtmlContainers: string[] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child.type === "html") {
      if (child.value) {
        updateIgnoredRawHtmlContainers(child.value, ignoredRawHtmlContainers);
      }
      continue;
    }
    if (ignoredRawHtmlContainers.length > 0) continue;

    if (child.type === "text" && child.value) {
      const replacements = linkCommitHashes(child.value, commitLinks);
      if (replacements.length > 1 || replacements[0]?.type !== "text") {
        node.children.splice(index, 1, ...replacements);
        index += replacements.length - 1;
      }
      continue;
    }

    transformChildren(child, commitLinks);
  }
}

export function remarkCommitLinks(options: CommitLinkOptions) {
  const commitLinks = new Map(
    options.commitLinks?.map(({ ref, url }) => [ref.toLowerCase(), url]),
  );

  return (tree: MarkdownNode) => {
    if (commitLinks.size > 0) {
      transformChildren(tree, commitLinks);
    }
  };
}

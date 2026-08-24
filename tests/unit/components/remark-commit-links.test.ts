import { describe, expect, it } from "vitest";

import { remarkCommitLinks } from "@/components/remark-commit-links";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

function transform(
  tree: MarkdownNode,
  commitLinks: Array<{ ref: string; sha: string }> = [],
  repositoryUrl = "https://github.com/owner/repo",
) {
  remarkCommitLinks({
    commitLinks: commitLinks.map((link) => ({
      ...link,
      url: `${repositoryUrl}/commit/${link.sha}`,
    })),
  })(tree);
  return tree;
}

describe("remarkCommitLinks", () => {
  it("turns abbreviated and full commit hashes into repository links", () => {
    const fullHash = "1234567890abcdef1234567890abcdef12345678";
    const tree = transform(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: `Fix 1234567 and ${fullHash}.` }],
          },
        ],
      },
      [
        { ref: "1234567", sha: "1234567890123456789012345678901234567890" },
        { ref: fullHash, sha: fullHash },
      ],
    );

    expect(tree.children?.[0].children).toEqual([
      { type: "text", value: "Fix " },
      {
        type: "link",
        url: "https://github.com/owner/repo/commit/1234567890123456789012345678901234567890",
        children: [{ type: "inlineCode", value: "1234567" }],
      },
      { type: "text", value: " and " },
      {
        type: "link",
        url: `https://github.com/owner/repo/commit/${fullHash}`,
        children: [{ type: "inlineCode", value: fullHash.slice(0, 7) }],
      },
      { type: "text", value: "." },
    ]);
  });

  it("uses provider-supplied commit URLs without assuming GitHub paths", () => {
    const tree: MarkdownNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Fix abcdef1" }],
        },
      ],
    };

    remarkCommitLinks({
      commitLinks: [
        {
          ref: "abcdef1",
          sha: "abcdef1234567890abcdef1234567890abcdef12",
          url: "https://gitlab.example/group/repo/-/commit/abcdef1234567890abcdef1234567890abcdef12",
        },
      ],
    })(tree);

    expect(tree.children?.[0].children?.[1]).toMatchObject({
      type: "link",
      url: "https://gitlab.example/group/repo/-/commit/abcdef1234567890abcdef1234567890abcdef12",
    });
  });

  it("leaves hashes in existing links and code unchanged", () => {
    const tree = transform(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url: "https://example.test/already-linked",
                children: [{ type: "text", value: "3e1101f" }],
              },
              { type: "text", value: " " },
              { type: "inlineCode", value: "21f7362" },
            ],
          },
        ],
      },
      [
        { ref: "3e1101f", sha: "3e1101f000000000000000000000000000000000" },
        { ref: "21f7362", sha: "21f736200000000000000000000000000000000" },
      ],
    );

    expect(tree.children?.[0].children).toEqual([
      {
        type: "link",
        url: "https://example.test/already-linked",
        children: [{ type: "text", value: "3e1101f" }],
      },
      { type: "text", value: " " },
      { type: "inlineCode", value: "21f7362" },
    ]);
  });

  it("does not create nested links inside raw HTML anchors", () => {
    const sha = `abcdef1${"a".repeat(33)}`;
    const tree = transform(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "html",
                value: '<a href="https://example.test/already-linked">',
              },
              { type: "text", value: "abcdef1" },
              { type: "html", value: "</a>" },
              { type: "text", value: " and abcdef1" },
            ],
          },
        ],
      },
      [{ ref: "abcdef1", sha }],
    );

    expect(tree.children?.[0].children).toEqual([
      {
        type: "html",
        value: '<a href="https://example.test/already-linked">',
      },
      { type: "text", value: "abcdef1" },
      { type: "html", value: "</a>" },
      { type: "text", value: " and " },
      {
        type: "link",
        url: `https://github.com/owner/repo/commit/${sha}`,
        children: [{ type: "inlineCode", value: "abcdef1" }],
      },
    ]);
  });

  it("does not link unconfirmed hexadecimal strings", () => {
    const tree = transform({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: "Keep c0ffee1, 20260824, and 550e8400 from a UUID.",
            },
          ],
        },
      ],
    });

    expect(tree.children?.[0].children).toEqual([
      {
        type: "text",
        value: "Keep c0ffee1, 20260824, and 550e8400 from a UUID.",
      },
    ]);
  });

  it("does not rewrite repository references or embedded identifiers", () => {
    const sha = `deadbee${"a".repeat(33)}`;
    const tree = transform(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value:
                  "Fix deadbee, keep other/project@deadbee and prefixdeadbeesuffix.",
              },
            ],
          },
        ],
      },
      [{ ref: "deadbee", sha }],
    );

    expect(tree.children?.[0].children).toEqual([
      { type: "text", value: "Fix " },
      {
        type: "link",
        url: `https://github.com/owner/repo/commit/${sha}`,
        children: [{ type: "inlineCode", value: "deadbee" }],
      },
      {
        type: "text",
        value: ", keep other/project@deadbee and prefixdeadbeesuffix.",
      },
    ]);
  });

  it("uses a canonical repository URL supplied by the provider", () => {
    const sha = "1234567890abcdef1234567890abcdef12345678";
    const tree = transform(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Fix 1234567" }],
          },
        ],
      },
      [{ ref: "1234567", sha }],
      "https://github.com/new-owner/new-repo",
    );

    expect(tree.children?.[0].children?.[1]?.url).toBe(
      `https://github.com/new-owner/new-repo/commit/${sha}`,
    );
  });
});

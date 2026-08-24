import { describe, expect, it } from "vitest";

import {
  extractGithubReleaseBodyHtml,
  findGithubCommitRefCandidates,
  resolveGithubCommitLinks,
} from "@/lib/releases/github-markdown";

describe("github-markdown", () => {
  it("extracts only the rendered release body from a GitHub page", () => {
    const pageHtml = `
      <meta name="description" content="Header 1111111">
      <a href="/owner/repo/commit/1111111111111111111111111111111111111111">1111111</a>
      <div data-pjax="true" data-test-selector="body-content" class="markdown-body">
        <p>Release 2222222</p>
        <div><a href="/owner/repo/commit/2222222222222222222222222222222222222222">2222222</a></div>
        <!-- <div>ignored nesting</div> -->
      </div>
      <a href="/owner/repo/commit/3333333333333333333333333333333333333333">3333333</a>
    `;

    const releaseBody = extractGithubReleaseBodyHtml(pageHtml);

    expect(releaseBody).toContain("Release 2222222");
    expect(releaseBody).toContain("2222222222222222222222222222222222222222");
    expect(releaseBody).not.toContain("1111111");
    expect(releaseBody).not.toContain("3333333");
  });

  it("rejects pages without a complete release body container", () => {
    expect(
      extractGithubReleaseBodyHtml(
        '<meta content="1234567"><div>Something went wrong</div>',
      ),
    ).toBeNull();
    expect(
      extractGithubReleaseBodyHtml(
        '<div data-test-selector="body-content">incomplete',
      ),
    ).toBeNull();
  });

  it("finds all hexadecimal commit candidates without guessing validity", () => {
    expect(
      findGithubCommitRefCandidates(
        "Commits 1234567, abcdefa, C0FFEE1, and c0ffee1.",
      ),
    ).toEqual(["1234567", "abcdefa", "c0ffee1"]);
  });

  it("ignores hashes embedded in identifiers and repository references", () => {
    expect(
      findGithubCommitRefCandidates(
        "Commit deadbee, owner/repo@deadbee, prefixdeadbeesuffix, #deadbee, and value_deadbee.",
      ),
    ).toEqual(["deadbee"]);
  });

  it("keeps only candidates GitHub rendered as commits in the repository", () => {
    const numericSha = "1234567890123456789012345678901234567890";
    const lettersSha = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const markdown =
      "Features\n\n- 1234567 Numeric SHA\n- abcdefa Letter SHA\n- c0ffee1 Arbitrary identifier";
    const renderedHtml = `
      <ul>
        <li><a href="/owner/repo/commit/${numericSha}"><tt>1234567</tt></a> Numeric SHA</li>
        <li><a href="https://github.com/owner/repo/commit/${lettersSha}"><tt>abcdefa</tt></a> Letter SHA</li>
        <li>c0ffee1 Arbitrary identifier</li>
      </ul>
    `;

    expect(
      resolveGithubCommitLinks(markdown, renderedHtml, "owner", "repo"),
    ).toEqual([
      {
        ref: "1234567",
        sha: numericSha,
        url: `https://github.com/owner/repo/commit/${numericSha}`,
      },
      {
        ref: "abcdefa",
        sha: lettersSha,
        url: `https://github.com/owner/repo/commit/${lettersSha}`,
      },
    ]);
  });

  it("ignores commit links belonging to another repository or host", () => {
    const sha = "c0ffee1234567890123456789012345678901234";
    const renderedHtml = `
      <a href="https://github.com/other/repo/commit/${sha}">c0ffee1</a>
      <a href="https://example.test/owner/repo/commit/${sha}">c0ffee1</a>
    `;

    expect(
      resolveGithubCommitLinks("Commit c0ffee1", renderedHtml, "owner", "repo"),
    ).toEqual([]);
  });

  it("does not infer an unrendered short ref from a longer rendered ref", () => {
    const sha = "abcdef0123456789abcdef0123456789abcdef01";
    const renderedRef = sha.slice(0, 10);
    const renderedHtml = `<a href="/owner/repo/commit/${sha}"><tt>${renderedRef}</tt></a>`;

    expect(
      resolveGithubCommitLinks(
        `Ambiguous abcdef0, confirmed ${renderedRef}`,
        renderedHtml,
        "owner",
        "repo",
      ),
    ).toEqual([
      {
        ref: renderedRef,
        sha,
        url: `https://github.com/owner/repo/commit/${sha}`,
      },
    ]);
  });

  it("rejects an abbreviated ref that points at multiple rendered commits", () => {
    const firstSha = `abcdef0${"a".repeat(33)}`;
    const secondSha = `abcdef0${"b".repeat(33)}`;
    const renderedHtml = `
      <a href="/owner/repo/commit/${firstSha}"><tt>abcdef0</tt></a>
      <a href="/owner/repo/commit/${secondSha}"><tt>abcdef0</tt></a>
    `;

    expect(
      resolveGithubCommitLinks(
        "Ambiguous abcdef0",
        renderedHtml,
        "owner",
        "repo",
      ),
    ).toEqual([]);
  });
});

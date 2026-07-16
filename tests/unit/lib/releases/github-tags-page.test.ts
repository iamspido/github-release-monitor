import { parseGithubTagsPage } from "@/lib/releases/github-tags-page";

describe("parseGithubTagsPage", () => {
  it("keeps GitHub's displayed order and extracts safe tag metadata", () => {
    const html = `
      <div class="Box-row">
        <h2><a href="/golang/go/releases/tag/go1.27rc2">go1.27rc2</a></h2>
        <relative-time datetime="2026-07-07T19:42:34Z">Jul 7</relative-time>
        <a href="/golang/go/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">aaaaaaa</a>
      </div>
      <div class="Box-row">
        <h2><a href="/example/repo/releases/tag/release%2F1.0.0">release/1.0.0</a></h2>
        <relative-time class="no-wrap" datetime="2026-07-07T19:29:04Z">Jul 7</relative-time>
        <a href="/example/repo/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb">bbbbbbb</a>
      </div>
    `;

    expect(parseGithubTagsPage(html)).toEqual([
      {
        name: "go1.27rc2",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        updatedAt: "2026-07-07T19:42:34Z",
      },
      {
        name: "release/1.0.0",
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        updatedAt: "2026-07-07T19:29:04Z",
      },
    ]);
  });

  it("ignores malformed entries", () => {
    expect(
      parseGithubTagsPage(`
        <a href="/o/r/releases/tag/v1">v1</a>
        <relative-time datetime="not-a-date"></relative-time>
        <a href="/o/r/commit/not-a-sha">bad</a>
      `),
    ).toEqual([]);
  });
});

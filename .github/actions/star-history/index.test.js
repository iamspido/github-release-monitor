import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  DARK_THEME,
  escapeXml,
  fetchStarTimes,
  generateCharts,
  LIGHT_THEME,
  niceStep,
  renderSvg,
  validateRepository,
} from "./index.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function restResponse(payload, link = null) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name.toLowerCase() === "link" ? link : null),
    },
    text: async () => JSON.stringify(payload),
  };
}

test("validates repository names", () => {
  assert.deepEqual(validateRepository("iamspido/github-release-monitor"), {
    owner: "iamspido",
    name: "github-release-monitor",
  });
  assert.throws(
    () => validateRepository("owner/repo/extra"),
    /Invalid repository name/,
  );
  assert.throws(
    () => validateRepository("owner/<script>"),
    /Invalid repository name/,
  );
});

test("escapes XML metacharacters", () => {
  assert.equal(
    escapeXml(`<tag a="b">Tom & Jerry's</tag>`),
    "&lt;tag a=&quot;b&quot;&gt;Tom &amp; Jerry&apos;s&lt;/tag&gt;",
  );
});

test("selects readable chart steps", () => {
  assert.equal(niceStep(0.25), 1);
  assert.equal(niceStep(23), 50);
  assert.equal(niceStep(250), 500);
});

test("fetches and sorts every REST API page", async () => {
  const calls = [];
  const responses = [
    restResponse(
      [{ starred_at: "2024-02-02T00:00:00Z" }],
      '<https://api.github.com/repositories/1/stargazers?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/stargazers?per_page=100&page=2>; rel="last"',
    ),
    restResponse([{ starred_at: "2024-01-01T00:00:00Z" }]),
  ];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  };

  const result = await fetchStarTimes("owner/repo", "test-token", fakeFetch);

  assert.deepEqual(result, ["2024-01-01T00:00:00Z", "2024-02-02T00:00:00Z"]);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/owner/repo/stargazers?per_page=100&page=1",
  );
  assert.equal(
    calls[1].url,
    "https://api.github.com/repos/owner/repo/stargazers?per_page=100&page=2",
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(
    calls[0].options.headers.Accept,
    "application/vnd.github.star+json",
  );
});

test("rejects malformed REST API timestamps", async () => {
  const fakeFetch = async () => restResponse([{ starred_at: "not-a-date" }]);

  await assert.rejects(
    fetchStarTimes("owner/repo", "test-token", fakeFetch),
    /invalid stargazer timestamp/,
  );
});

test("renders passive light and dark SVG files", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "star-history-test-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const fakeFetch = async () =>
    restResponse([
      { starred_at: "2024-01-01T00:00:00Z" },
      { starred_at: "2024-03-01T00:00:00Z" },
    ]);

  const result = await generateCharts({
    repository: "owner/repo",
    token: "test-token",
    outputRoot: temporaryDirectory,
    fetchImplementation: fakeFetch,
  });
  const light = readFileSync(result.lightPath, "utf8");
  const dark = readFileSync(result.darkPath, "utf8");

  assert.match(light, /^<svg /);
  assert.match(light, /owner\/repo star history, 2 stars/);
  assert.match(light, new RegExp(`fill="${LIGHT_THEME.background}"`));
  assert.match(dark, new RegExp(`fill="${DARK_THEME.background}"`));
  for (const svg of [light, dark]) {
    assert.doesNotMatch(svg, /<(?:script|image|foreignObject)/i);
    assert.doesNotMatch(svg, /\s(?:href|onload)=/i);
    assert.match(svg, /<\/svg>$/);
  }
});

test("renders deterministic SVG output", () => {
  const timestamps = ["2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"];
  assert.equal(
    renderSvg("owner/repo", timestamps, LIGHT_THEME),
    renderSvg("owner/repo", timestamps, LIGHT_THEME),
  );
});

test("renders ordinary repository names without truncation", () => {
  const svg = renderSvg(
    "iamspido/github-release-monitor",
    ["2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"],
    LIGHT_THEME,
  );

  assert.match(svg, />iamspido\/github-release-monitor<\/text>/);
  assert.doesNotMatch(svg, /iamspido\/gith…elease-monitor/);
});

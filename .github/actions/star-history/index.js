import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

const WIDTH = 720;
const HEIGHT = 360;
const MARGIN = 28;
const PLOT_X0 = 60;
const PLOT_X1 = 692;
const PLOT_Y0 = 96;
const PLOT_Y1 = 300;

const FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const FONT_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const LIGHT_THEME = Object.freeze({
  background: "#ffffff",
  border: "#d8dee4",
  grid: "#eaeef2",
  textPrimary: "#1f2328",
  textSecondary: "#656d76",
  textFaint: "#8c959f",
  line: "#0969da",
});

const DARK_THEME = Object.freeze({
  background: "#0d1117",
  border: "#30363d",
  grid: "#21262d",
  textPrimary: "#e6edf3",
  textSecondary: "#8b949e",
  textFaint: "#6e7681",
  line: "#58a6ff",
});

function getInput(name) {
  const environmentName = `INPUT_${name.toUpperCase()}`;
  const value = process.env[environmentName]?.trim();
  if (!value) {
    throw new Error(`Missing required input: ${name.toLowerCase()}`);
  }
  return value;
}

function validateRepository(repository) {
  const match = repository.match(
    /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/,
  );
  if (!match) {
    throw new Error(`Invalid repository name: ${repository}`);
  }
  return { owner: match[1], name: match[2] };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTick(value) {
  if (value >= 1_000) {
    return `${value / 1_000}k`;
  }
  return String(value);
}

function niceStep(raw) {
  if (raw <= 1) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = magnitude * multiplier;
    if (candidate >= raw) {
      return candidate;
    }
  }
  return magnitude * 10;
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatAxisDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

function truncateRepository(repository) {
  if (repository.length <= 42) {
    return repository;
  }
  return `${repository.slice(0, 20)}…${repository.slice(-21)}`;
}

function renderSvg(repository, timestamps, theme) {
  if (timestamps.length === 0) {
    throw new Error("Cannot render a chart without stargazer timestamps");
  }

  const dates = timestamps.map((timestamp) => new Date(timestamp));
  const total = dates.length;
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const startTime = firstDate.getTime();
  const endTime = lastDate.getTime();
  const span = endTime - startTime;
  const step = niceStep(total / 4);
  const yTop = Math.max(step, Math.ceil((total + step) / step) * step);

  const xOf = (date) => {
    if (span <= 0) {
      return PLOT_X1;
    }
    return (
      PLOT_X0 + ((PLOT_X1 - PLOT_X0) * (date.getTime() - startTime)) / span
    );
  };
  const yOf = (count) => PLOT_Y1 - ((PLOT_Y1 - PLOT_Y0) * count) / yTop;

  const samples = Math.min(64, Math.max(1, total - 1));
  const points = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    const index = Math.floor((sample * (total - 1)) / samples);
    points.push(`${xOf(dates[index]).toFixed(1)},${yOf(index + 1).toFixed(1)}`);
  }

  const endX = xOf(lastDate);
  const endY = yOf(total);
  const escapedRepository = escapeXml(repository);
  const tickAttributes = `font-family="${FONT_MONO}" font-size="11" fill="${theme.textSecondary}"`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" font-family="${FONT_SANS}">`,
    `<title>${escapedRepository} star history, ${formatCount(total)} stars</title>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="${theme.background}" stroke="${theme.border}"/>`,
    `<text x="${MARGIN}" y="42" font-size="20" font-weight="600" fill="${theme.textPrimary}">${escapeXml(truncateRepository(repository))}</text>`,
    `<text x="${MARGIN}" y="62" font-size="12" fill="${theme.textSecondary}">Stars · ${formatMonth(firstDate)} – ${formatMonth(lastDate)}</text>`,
    `<text x="${PLOT_X1}" y="48" text-anchor="end" font-size="28" font-weight="700" fill="${theme.textPrimary}" font-family="${FONT_MONO}">${formatCount(total)}</text>`,
    `<text x="${PLOT_X1}" y="66" text-anchor="end" font-size="11" fill="${theme.textSecondary}">total stars</text>`,
  ];

  for (let value = step; value <= yTop; value += step) {
    const y = yOf(value);
    parts.push(
      `<line x1="${PLOT_X0}" y1="${y.toFixed(1)}" x2="${PLOT_X1}" y2="${y.toFixed(1)}" stroke="${theme.grid}" stroke-width="1"/>`,
      `<text x="${MARGIN + 24}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" ${tickAttributes}>${formatTick(value)}</text>`,
    );
  }

  parts.push(
    `<line x1="${PLOT_X0}" y1="${PLOT_Y1}" x2="${PLOT_X1}" y2="${PLOT_Y1}" stroke="${theme.border}" stroke-width="1"/>`,
  );

  for (let index = 0; index < 5; index += 1) {
    const tickDate = new Date(startTime + (span * index) / 4);
    parts.push(
      `<text x="${xOf(tickDate).toFixed(1)}" y="322" text-anchor="middle" ${tickAttributes}>${formatAxisDate(tickDate)}</text>`,
    );
  }

  const firstX = xOf(firstDate);
  parts.push(
    `<polygon points="${firstX.toFixed(1)},${PLOT_Y1} ${points.join(" ")} ${endX.toFixed(1)},${PLOT_Y1}" fill="${theme.line}" fill-opacity="0.07"/>`,
    `<polyline points="${points.join(" ")}" fill="none" stroke="${theme.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="3.5" fill="${theme.line}" stroke="${theme.background}" stroke-width="1.5"/>`,
    `<text x="${PLOT_X1}" y="346" text-anchor="end" font-size="10" fill="${theme.textFaint}" font-family="${FONT_MONO}">★ Star History</text>`,
    "</svg>",
  );

  return parts.join("");
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestStargazerPage(
  owner,
  name,
  page,
  token,
  fetchImplementation,
) {
  const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/stargazers?per_page=${PAGE_SIZE}&page=${page}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetchImplementation(url, {
      headers: {
        Accept: "application/vnd.github.star+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "github-release-monitor-star-history",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const responseBody = await response.text();
    if (response.ok) {
      let payload;
      try {
        payload = JSON.parse(responseBody);
      } catch {
        throw new Error("GitHub REST API returned invalid JSON");
      }
      if (!Array.isArray(payload)) {
        throw new Error("GitHub REST API returned an invalid stargazer page");
      }
      return {
        stargazers: payload,
        link: response.headers?.get?.("link") ?? null,
      };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      if (response.status === 403) {
        throw new Error(
          "GitHub REST API denied stargazer access (HTTP 403); user tokens require repository admin/collaborator access and installation tokens require contents: write",
        );
      }
      throw new Error(
        `GitHub REST API request failed with HTTP ${response.status}`,
      );
    }
    await sleep(2 ** (attempt - 1) * 1_000);
  }

  throw new Error("GitHub REST API request exhausted its retries");
}

async function fetchStarTimes(repository, token, fetchImplementation = fetch) {
  const { owner, name } = validateRepository(repository);
  const timestamps = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await requestStargazerPage(
      owner,
      name,
      page,
      token,
      fetchImplementation,
    );

    for (const stargazer of result.stargazers) {
      const timestamp = stargazer?.starred_at;
      if (
        typeof timestamp !== "string" ||
        Number.isNaN(Date.parse(timestamp))
      ) {
        throw new Error(
          "GitHub REST API returned an invalid stargazer timestamp",
        );
      }
      timestamps.push(timestamp);
    }

    const hasNextLink =
      typeof result.link === "string" &&
      /(?:^|,)\s*<[^>]+>;\s*rel="next"/.test(result.link);
    const hasAnotherPage =
      result.link === null
        ? result.stargazers.length === PAGE_SIZE
        : hasNextLink;
    if (!hasAnotherPage) {
      timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
      return timestamps;
    }
  }

  throw new Error(
    `Repository exceeds the safety limit of ${MAX_PAGES * PAGE_SIZE} stars`,
  );
}

async function generateCharts({
  repository,
  token,
  outputRoot,
  fetchImplementation = fetch,
}) {
  const timestamps = await fetchStarTimes(
    repository,
    token,
    fetchImplementation,
  );
  if (timestamps.length === 0) {
    throw new Error("The repository has no stargazers to chart");
  }

  const assetsDirectory = path.join(outputRoot, "assets");
  const lightPath = path.join(assetsDirectory, "star-history.svg");
  const darkPath = path.join(assetsDirectory, "star-history-dark.svg");
  mkdirSync(assetsDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(lightPath, renderSvg(repository, timestamps, LIGHT_THEME), {
    mode: 0o600,
  });
  writeFileSync(darkPath, renderSvg(repository, timestamps, DARK_THEME), {
    mode: 0o600,
  });
  return { lightPath, darkPath, count: timestamps.length };
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
  }
}

async function main() {
  const token = getInput("TOKEN");
  const repository = getInput("REPOSITORY");
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) {
    throw new Error("RUNNER_TEMP must be an absolute path");
  }

  const outputRoot = path.join(runnerTemp, "star-history-generated");
  const result = await generateCharts({ repository, token, outputRoot });
  setOutput("light", result.lightPath);
  setOutput("dark", result.darkPath);
  process.stdout.write(
    `Generated light and dark charts for ${result.count} stars.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`::error::${escapeWorkflowCommand(error.message)}\n`);
    process.exitCode = 1;
  });
}

export {
  DARK_THEME,
  escapeXml,
  fetchStarTimes,
  formatCount,
  generateCharts,
  LIGHT_THEME,
  niceStep,
  renderSvg,
  validateRepository,
};

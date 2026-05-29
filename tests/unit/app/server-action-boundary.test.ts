// vitest globals enabled

import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function hasModuleLevelUseServer(source: string) {
  return /^\s*["']use server["'];?\s*(?:\r?\n|$)/.test(source);
}

describe("server action boundary", () => {
  it.each([
    "src/lib/storage/repositories.ts",
    "src/lib/storage/settings.ts",
    "src/lib/storage/system-status.ts",
    "src/lib/runtime/update-check.ts",
    "src/lib/notifications/email.ts",
    "src/lib/notifications/index.ts",
  ])("keeps %s as an internal server module", (relativePath) => {
    expect(hasModuleLevelUseServer(readSource(relativePath))).toBe(false);
  });

  it("keeps auth guards on exposed helper actions in src/app/actions.ts", () => {
    const source = readSource("src/app/actions.ts");
    const guardedExports = [
      "getLatestReleasesForRepos",
      "refreshMultipleRepositoriesAction",
      "checkForNewReleases",
      "getUpdateNotificationState",
      "getGitHubRateLimit",
      "getGitlabTokenCheck",
      "getCodebergTokenCheck",
      "getRepositoriesForExport",
      "revalidateReleasesAction",
      "getJobStatusAction",
    ];

    for (const exportName of guardedExports) {
      const start = source.indexOf(`export async function ${exportName}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const nextExport = source.indexOf("\nexport async function ", start + 1);
      const body =
        nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
      expect(body).toContain("canCallExposedRestrictedAction()");
    }
  });
});

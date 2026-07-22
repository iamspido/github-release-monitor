// vitest globals enabled

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const e2eDirectory = path.join(process.cwd(), "tests", "e2e");

const playwrightTestFilePattern = /\.(?:spec|test)\.(?:[cm]?[jt]s|[jt]sx)$/;

function findPlaywrightTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findPlaywrightTestFiles(entryPath);
    }
    return playwrightTestFilePattern.test(entry.name) ? [entryPath] : [];
  });
}

describe("E2E fixture imports", () => {
  it("routes every Playwright spec through the worker fixture", () => {
    const directImports = findPlaywrightTestFiles(e2eDirectory)
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return source.includes("@playwright/test");
      })
      .map((filePath) => path.relative(process.cwd(), filePath));

    expect(directImports).toEqual([]);
  });
});

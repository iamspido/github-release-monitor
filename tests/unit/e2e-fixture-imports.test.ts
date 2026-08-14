// vitest globals enabled

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const e2eDirectory = path.join(process.cwd(), "tests", "e2e");

const playwrightTestFilePattern = /\.(?:spec|test)\.(?:[cm]?[jt]s|[jt]sx)$/;
const unauthenticatedSpecs = new Set([
  "auth-open-redirect.spec.ts",
  "auth-redirect.spec.ts",
  "auth-setup-lock.spec.ts",
  "i18n-fallback.spec.ts",
  "landmarks-a11y.spec.ts",
  "login-focus-on-error.spec.ts",
  "login.spec.ts",
  "logout-flow.spec.ts",
  "mobile-header-back.spec.ts",
  "mobile-logout.spec.ts",
  "mobile-menu-a11y.spec.ts",
  "not-found-ui.spec.ts",
  "not-found.spec.ts",
  "password-recovery.spec.ts",
  "secure-redirect-login-loop.spec.ts",
  "security-headers-extra.spec.ts",
  "security-headers.spec.ts",
  "session-cookie-flags.spec.ts",
  "session-expire-redirect.spec.ts",
  "session-persistence.spec.ts",
  "session-tab-logout.spec.ts",
]);

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

  it("uses prepared authentication and repository baselines where declared", () => {
    const fixtureMismatches = findPlaywrightTestFiles(e2eDirectory)
      .filter((filePath) => filePath.endsWith(".spec.ts"))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, "utf8");
        const relativePath = path.relative(process.cwd(), filePath);
        const relativeE2ePath = path
          .relative(e2eDirectory, filePath)
          .split(path.sep)
          .join("/");
        const usesTestRepoHelper = source.includes("ensureTestRepo(page)");
        const testsRepoSetup = filePath.endsWith("test-repo.spec.ts");
        const needsAuthentication = !unauthenticatedSpecs.has(relativeE2ePath);
        const usesAuthenticatedFixture =
          source.includes('"./fixtures/ensureLoggedIn"') ||
          source.includes('"./fixtures/withTestRepo"');
        const usesTestRepoFixture = source.includes(
          '"./fixtures/withTestRepo"',
        );
        const definesLocalLoginHelper =
          /(?:async\s+)?function\s+login\s*\(/.test(source);
        const mismatches: string[] = [];

        if (definesLocalLoginHelper) {
          mismatches.push(`${relativePath}: defines a local login helper`);
        }
        if (needsAuthentication && !usesAuthenticatedFixture) {
          mismatches.push(`${relativePath}: missing authenticated fixture`);
        }
        if (!needsAuthentication && usesAuthenticatedFixture) {
          mismatches.push(`${relativePath}: unexpected authenticated fixture`);
        }
        if (usesTestRepoHelper && !testsRepoSetup && !usesTestRepoFixture) {
          mismatches.push(`${relativePath}: missing test-repo fixture`);
        }
        if (usesTestRepoFixture && !usesTestRepoHelper) {
          mismatches.push(`${relativePath}: unnecessary test-repo fixture`);
        }

        return mismatches;
      });

    expect(fixtureMismatches).toEqual([]);
  });
});

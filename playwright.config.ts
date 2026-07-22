import {
  defineConfig,
  devices,
  type ReporterDescription,
} from "@playwright/test";

const reporters: ReporterDescription[] = [["list"]];
if (process.env.CI) {
  reporters.push([
    "html",
    { outputFolder: "playwright-report", open: "never" },
  ]);
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  // BASE_URL keeps the legacy single-server mode; local runs isolate four workers.
  workers: process.env.BASE_URL ? 1 : 4,
  outputDir: "test-results",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  reporter: reporters,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

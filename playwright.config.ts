import { defineConfig, devices } from '@playwright/test';

const reporters: any[] = [['list']];
if (process.env.CI) {
  reporters.push(['html', { outputFolder: 'playwright-report', open: 'never' }]);
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  reporter: reporters as any,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
      HTTPS: 'false',
      BACKGROUND_POLLING_INITIALIZED: 'true',
      AUTH_SECRET: 'x'.repeat(64),
      AUTH_USERNAME: process.env.AUTH_USERNAME || 'test',
      AUTH_PASSWORD: process.env.AUTH_PASSWORD || 'test',
    },
  },
});

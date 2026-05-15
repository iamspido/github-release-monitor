import { defineConfig, devices } from '@playwright/test';

const reporters: any[] = [['list']];
if (process.env.CI) {
  reporters.push(['html', { outputFolder: 'playwright-report', open: 'never' }]);
}

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
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
      BETTER_AUTH_SECRET: 'x'.repeat(64),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
      AUTH_SETUP_TOKEN: process.env.AUTH_SETUP_TOKEN || 'y'.repeat(64),
      AUTH_EMAIL: process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com',
      AUTH_PASSWORD: process.env.AUTH_PASSWORD || 'TestPassword123',
      GITLAB_ADDITIONAL_HOSTS: process.env.GITLAB_ADDITIONAL_HOSTS || 'gitlab.self.test',
    },
  },
});

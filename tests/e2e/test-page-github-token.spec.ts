import { test, expect } from '@playwright/test';

async function login(page) {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('GitHub token hint visible when token is not set', async ({ page }) => {
  await login(page);
  await page.goto('/en/test');

  // Status indicator and hint text
  await expect(page.getByText('GITHUB_ACCESS_TOKEN not set.')).toBeVisible();
  await expect(
    page.getByText(
      'The app will work, but you may be rate-limited by GitHub (60 requests/hour). Add a token to your .env file for a higher limit (5000 requests/hour).'
    )
  ).toBeVisible();

  // Codeberg token indicator and hint text
  await expect(page.getByText('CODEBERG_ACCESS_TOKEN not set.')).toBeVisible();
  await expect(
    page.getByText(
      'The app will work without a token for public repositories. Add CODEBERG_ACCESS_TOKEN to access private repositories and to reduce the chance of rate limiting.'
    )
  ).toBeVisible();
});

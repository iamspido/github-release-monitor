import { test, expect } from '@playwright/test';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
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
});


import { test, expect } from '@playwright/test';

test('invalid path returns 404 when logged in', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  // Login first to avoid middleware redirect to login page
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const resp = await page.goto('/en/this-page-does-not-exist');
  expect(resp?.status()).toBe(404);
});

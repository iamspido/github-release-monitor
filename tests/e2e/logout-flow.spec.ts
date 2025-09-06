import { test, expect } from '@playwright/test';

test('logout redirects to login and protects home', async ({ page }) => {
  // Login first
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Click header logout (desktop header button with aria-label)
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.getByRole('heading', { name: 'Login to GitHub Release Monitor' })).toBeVisible();

  // Now navigate to /en (should be protected and redirect to login with optional next param)
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});

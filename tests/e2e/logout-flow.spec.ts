import { test, expect } from '@playwright/test';

test('logout redirects to login and protects home', async ({ page }) => {
  // Login first
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Click header logout (desktop header button with aria-label)
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.getByRole('heading', { name: 'Login to GitHub Release Monitor' })).toBeVisible();

  // Now navigate to /en (should be protected and redirect to login with optional next param)
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});

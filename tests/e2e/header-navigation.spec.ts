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

test('header navigation: Home, Settings, Test routes work', async ({ page }) => {
  await login(page);

  // Ensure we start on Home
  await page.goto('/en');

  // Navigate to Settings via header button (role-based selector)
  await page.getByRole('button', { name: 'Open settings page' }).click();
  await expect(page).toHaveURL(/\/(en|de)\/settings$/);

  // Navigate back to Home
  await page.getByRole('button', { name: 'Back to home page' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Navigate to Test page
  await page.getByRole('button', { name: 'Open test page' }).click();
  await expect(page).toHaveURL(/\/(en|de)\/test$/);
  await expect(page.getByRole('heading', { name: 'System Configuration Test' })).toBeVisible();
});


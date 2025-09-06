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


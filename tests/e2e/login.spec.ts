import { test, expect } from '@playwright/test';

test('can login with valid credentials', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';

  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await expect(page.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();
});

test('test page renders after login', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';

  await page.goto('/en/login?next=/en/test');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/en\/test$/);
  await expect(page.getByRole('heading', { name: 'System Configuration Test' })).toBeVisible();
});


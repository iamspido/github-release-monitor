import { test, expect } from '@playwright/test';

test('unauthenticated user is redirected to login', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/test');
  await expect(page.getByRole('heading', { name: 'Login to GitHub Release Monitor' })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/login/);
});

test('failed login shows error and clears password field', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login');
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();
  // Still on login page
  await expect(page).toHaveURL(/\/en\/login/);
  // Password cleared
  await expect(page.getByLabel('Password')).toHaveValue('');
});


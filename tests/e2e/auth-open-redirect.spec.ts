import { test, expect } from '@playwright/test';

test('open redirect is prevented and lands on app root', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login?next=https://evil.com');
  await page.getByLabel('Username').fill(process.env.AUTH_USERNAME || 'test');
  await page.getByLabel('Password').fill(process.env.AUTH_PASSWORD || 'test');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await expect(page.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();
});


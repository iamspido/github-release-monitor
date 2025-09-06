import { test, expect } from '@playwright/test';

test('session persists across reload and new tab; login page redirects when logged in', async ({ browser, page, context }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';

  // Login
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Reload: still logged in
  await page.reload();
  await expect(page.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();

  // New tab should inherit session
  const page2 = await context.newPage();
  await page2.goto('/en');
  await expect(page2.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();

  // Visiting login while logged in should redirect to home
  await page2.goto('/en/login');
  await expect(page2).toHaveURL(/\/(en|de)(\/)?$/);
});


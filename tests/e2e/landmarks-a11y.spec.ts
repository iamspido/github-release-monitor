import { test, expect } from '@playwright/test';

test('pages contain header and main landmarks', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  for (const path of ['/en', '/en/settings', '/en/test']) {
    await page.goto(path);
    await expect(page.getByRole('banner')).toBeVisible(); // header
    await expect(page.getByRole('main')).toBeVisible();   // main content
  }
});


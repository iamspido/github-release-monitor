import { test, expect } from '@playwright/test';

test('404 shows localized UI text', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const resp = await page.goto('/en/this-page-does-not-exist');
  expect(resp?.status()).toBe(404);
  // Next.js default 404 content (English); accept either EN or potential localized message
  const text = page.getByText(/This page could not be found\.|Not Found|Seite konnte nicht gefunden werden/i);
  await expect(text).toBeVisible();
});


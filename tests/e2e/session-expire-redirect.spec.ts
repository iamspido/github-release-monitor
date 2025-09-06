import { test, expect } from '@playwright/test';

test('after clearing session cookie, reload redirects to login', async ({ page, context }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';

  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Clear cookies to simulate session expiry
  await context.clearCookies();

  // Reload current page; middleware should redirect to login with optional next
  await page.reload();
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});


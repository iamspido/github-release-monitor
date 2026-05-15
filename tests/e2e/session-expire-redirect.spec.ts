import { test, expect } from '@playwright/test';

test('after clearing session cookie, reload redirects to login', async ({ page, context }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';

  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Clear cookies to simulate session expiry
  await context.clearCookies();

  // Reload current page; middleware should redirect to login with optional next
  await page.reload();
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});


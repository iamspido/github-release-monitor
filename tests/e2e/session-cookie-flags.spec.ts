import { test, expect } from '@playwright/test';

test('session cookie flags after login', async ({ page, context }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const cookies = await context.cookies();
  const session = cookies.find(c => c.name === 'better-auth.session_token');
  expect(session).toBeTruthy();
  // OAuth callbacks are cross-site navigations; SameSite=Strict would break them.
  expect(session?.sameSite).toMatch(/Lax/i);
  expect(session?.httpOnly).toBe(true);
  // In this test environment HTTPS=false, so secure should be false
  expect(session?.secure).toBe(false);
});

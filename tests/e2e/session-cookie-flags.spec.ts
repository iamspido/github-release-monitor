import { test, expect } from '@playwright/test';

test('session cookie flags after login', async ({ page, context }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const cookies = await context.cookies();
  const session = cookies.find(c => c.name === 'github-release-monitor-session');
  expect(session).toBeTruthy();
  expect(session?.sameSite).toMatch(/Strict/i);
  expect(session?.httpOnly).toBe(true);
  // In this test environment HTTPS=false, so secure should be false
  expect(session?.secure).toBe(false);
});


import { test, expect } from '@playwright/test';

test('locale persists via cookie across reload', async ({ page, context }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Set locale cookie to DE explicitly
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);

  await page.goto('/');
  await expect(page).toHaveURL(/\/de(\/|$)/);

  // Reload and verify still on DE
  await page.reload();
  await expect(page).toHaveURL(/\/de(\/|$)/);
});


import { test, expect } from '@playwright/test';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('locale cookie is honored by middleware', async ({ page }) => {
  await login(page);
  // Set cookie directly to focus purely on middleware behavior
  await page.context().addCookies([
    {
      name: 'NEXT_LOCALE',
      value: 'de',
      domain: 'localhost',
      path: '/',
    }
  ]);
  // Visit root without locale; should land on /de/…
  await page.goto('/');
  await expect(page).toHaveURL(/\/de(\/|$)/);
});

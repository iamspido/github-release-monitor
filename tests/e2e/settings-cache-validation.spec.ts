import { test, expect } from '@playwright/test';
import { assertNoAutosave } from './utils';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('cache > refresh shows error and blocks autosave', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  // Set refresh to 1 minute
  await page.locator('#interval-minutes').fill('1');
  await page.locator('#interval-hours').fill('0');
  await page.locator('#interval-days').fill('0');

  // Set cache to 2 minutes (greater than refresh)
  await page.locator('#cache-interval-minutes').fill('2');
  await page.locator('#cache-interval-hours').fill('0');
  await page.locator('#cache-interval-days').fill('0');

  await expect(page.getByText('Cache duration cannot be longer than the refresh interval.')).toBeVisible();

  // Autosave should not complete while invalid
  await assertNoAutosave(page);
});

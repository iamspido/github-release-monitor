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

test('global release channels require at least one selected', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  // Trying to uncheck the only selected channel should show a toast and not save
  const stable = page.getByLabel('Stable');
  await stable.click();

  await expect(page.getByText('At least one release type must be selected.').first()).toBeVisible();
  await assertNoAutosave(page);
});

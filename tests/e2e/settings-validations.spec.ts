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

test('refresh interval < 1 shows error and blocks autosave', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  // Set refresh interval to 0 minutes (below minimum)
  const minutes = page.getByLabel('Minutes', { exact: true }).or(page.getByLabel('Minuten', { exact: true })).first();
  await minutes.fill('0');

  // Inline error should be visible
  await expect(page.getByText('The refresh interval must be at least 1 minute.')).toBeVisible();

  // Autosave should not proceed while invalid
  await assertNoAutosave(page);
});

test('releases per page > 1000 shows inline error', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  const rpp = page.getByLabel('Number of releases to fetch per repository').or(page.getByLabel('Anzahl der pro Repository abzurufenden Releases'));
  await rpp.fill('1001');

  // Inline error should be visible
  await expect(page.getByText('The number cannot exceed 1000.')).toBeVisible();

  // Autosave should not proceed while invalid
  await assertNoAutosave(page);
});

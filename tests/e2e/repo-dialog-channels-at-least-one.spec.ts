import { test, expect } from '@playwright/test';
import { assertNoAutosave } from './utils';

async function loginAndEnsureRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('repo dialog channels require at least one selected', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  // Open repo settings dialog on first card
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Attempt to uncheck the only selected global channel (Stable)
  await page.getByLabel('Stable').click();

  await expect(
    page.getByText('At least one release type must be selected when overriding global settings.').first()
  ).toBeVisible();

  // No autosave while failure state
  await assertNoAutosave(page);

  await page.keyboard.press('Escape');
});

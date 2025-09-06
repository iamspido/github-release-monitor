import { test, expect } from '@playwright/test';
import { assertNotVisibleFor } from './utils';
import path from 'node:path';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('import confirmation cancel does not import or refresh', async ({ page }) => {
  await login(page);
  await page.goto('/en');

  const fileInput = page.locator('input[type="file"][accept=".json"]');
  const jsonPath = path.resolve(__dirname, 'fixtures', 'repos.json');
  await fileInput.setInputFiles(jsonPath);

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Give the UI a moment to settle and ensure no success toasts appear
  await assertNotVisibleFor(page.getByText('Import Successful', { exact: true }), 1500);
  await assertNotVisibleFor(page.getByText('Update Complete', { exact: true }), 1500);
});

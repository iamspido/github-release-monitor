import { test, expect } from '@playwright/test';
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

test('import confirmation dialog closes via ESC and does not import', async ({ page }) => {
  await login(page);
  await page.goto('/en');

  const fileInput = page.locator('input[type="file"][accept=".json"]');
  const jsonPath = path.resolve(__dirname, 'fixtures', 'repos.json');
  await fileInput.setInputFiles(jsonPath);

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // No success toasts
  await expect(page.getByText('Import Successful', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Update Complete', { exact: true })).toHaveCount(0);
});


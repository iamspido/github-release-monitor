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

test('import small JSON shows success and triggers refresh', async ({ page }) => {
  await login(page);
  await page.goto('/en');
  const fileInput = page.locator('input[type="file"][accept=".json"]');
  const jsonPath = path.resolve(__dirname, 'fixtures', 'repos.json');
  await fileInput.setInputFiles(jsonPath);
  // Confirm import in dialog
  // Click Import in the confirmation dialog (Radix uses role=alertdialog)
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Import' }).click();
  // Wait for import success toast (use exact text to avoid strict mode conflicts)
  await expect(page.getByText('Import Successful', { exact: true })).toBeVisible();
  // Wait for background refresh completion toast
  await expect(page.getByText('Update Complete', { exact: true })).toBeVisible();
  // Force a fresh render to pick up revalidated data
  await page.goto('/en');
  // Land on home and ensure the section renders
  await expect(page.getByRole('heading', { name: 'Monitored Repositories' })).toBeVisible();
  // (We already asserted success + completion toasts; card rendering depends on GitHub API
  // and is covered by other flows via the virtual test repo.)
});

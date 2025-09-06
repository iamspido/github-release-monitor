import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function loginAndEnsureRepo(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('export then import shows 0 new and updates existing without duplicates', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  // Export
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const path = '/tmp/roundtrip.json';
  await download.saveAs(path);
  expect(fs.existsSync(path)).toBeTruthy();

  // Import the exported file
  const fileInput = page.locator('input[type="file"][accept=".json"]');
  await fileInput.setInputFiles(path);

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/no new repositories|0 new repositories/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import' }).click();

  // Wait for refresh done toast (Update Complete)
  await expect(page.getByText('Update Complete', { exact: true })).toBeVisible();

  // Ensure only one test/test card exists
  const cards = page.getByText('test/test');
  await expect(cards).toHaveCount(1);
});


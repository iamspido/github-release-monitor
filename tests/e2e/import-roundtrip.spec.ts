import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('export then import shows 0 new and updates existing without duplicates', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

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
  await expect(page.getByText('test/test')).toHaveCount(1);
});

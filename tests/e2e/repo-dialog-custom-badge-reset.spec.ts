import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('repo dialog RPP sets Custom badge; Reset All removes it', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  // Open repo settings dialog on first card
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Set releases-per-page for repo to make it custom
  const rppRepo = page.locator('#releases-per-page-repo');
  await rppRepo.fill('10');
  // Wait for autosave debounce & save in the dialog
  await page.waitForTimeout(1700);

  // Close dialog (ESC) to trigger refresh
  await page.keyboard.press('Escape');

  // Expect Custom badge on the card (exact text)
  await expect(page.getByText(/^Custom$/).first()).toBeVisible();

  // Re-open dialog and reset all settings
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  await page.getByRole('button', { name: 'Reset All Settings' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, reset all' }).click();
  await page.waitForTimeout(1700);
  await page.keyboard.press('Escape');

  // Custom badge should disappear
  await expect(page.getByText(/^Custom$/)).toHaveCount(0);
});

import { test, expect } from '@playwright/test';
import { waitForAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test('global releases-per-page persists and reflects in repo dialog placeholder', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  // Change global RPP to 55
  await page.goto('/en/settings');
  const releasesPerPageInput = page.getByLabel('Number of releases to fetch per repository').or(page.getByLabel('Anzahl der pro Repository abzurufenden Releases'));
  await releasesPerPageInput.fill('55');
  await waitForAutosave(page);

  // Open repo dialog and check placeholder reflects 55
  await page.goto('/en');
  await waitForRepoLink(page);
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

  // Find the releases-per-page input in the dialog by type="number"
  const dialog = page.getByRole('dialog');
  const rppInput = dialog.locator('input[type="number"]').first();

  const placeholder = await rppInput.getAttribute('placeholder');
  expect(placeholder || '').toMatch(/Global default \(55\)/);

  // Ensure cards render without error
  await page.keyboard.press('Escape');
  await waitForRepoLink(page);
});

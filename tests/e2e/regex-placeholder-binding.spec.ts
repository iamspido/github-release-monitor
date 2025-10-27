import { test, expect } from '@playwright/test';
import { waitForAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test('global include/exclude regex reflected as placeholders in repo dialog', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  // Set global include/exclude regex
  await page.goto('/en/settings');
  const includeRegexInput = page.getByLabel('Include Pattern').or(page.getByLabel('Einschließen-Muster (Include)'));
  const excludeRegexInput = page.getByLabel('Exclude Pattern').or(page.getByLabel('Ausschließen-Muster (Exclude)'));
  
  await includeRegexInput.fill('^foo$');
  await excludeRegexInput.fill('^bar$');
  await waitForAutosave(page);

  // Open repo dialog and check placeholders
  await page.goto('/en');
  await waitForRepoLink(page);
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  
  // Find inputs by placeholder text since they should contain the global values
  const dialog = page.getByRole('dialog');
  const includeInput = dialog.getByPlaceholder('^foo$');
  const excludeInput = dialog.getByPlaceholder('^bar$');
  
  await expect(includeInput).toHaveAttribute('placeholder', '^foo$');
  await expect(excludeInput).toHaveAttribute('placeholder', '^bar$');
});

import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('repo dialog ESC closes without saving pending changes', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

  // Open repo dialog
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

  const dialog = page.getByRole('dialog');
  const rppInput = dialog.locator('input[type="number"]').first();
  const allTextInputs = dialog.locator('input[type="text"]');
  const includeInput = allTextInputs.first(); // Include regex is the first text input

  // Capture current persisted values to compare later
  const beforeRpp = await rppInput.inputValue();
  const beforeInc = await includeInput.inputValue();

  // Change some fields but close immediately before autosave debounce (1.5s)
  await rppInput.fill('77');
  await includeInput.fill('^v$');
  await page.keyboard.press('Escape');

  // Reopen and ensure values were not saved (empty means global)
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  
  const dialogAfter = page.getByRole('dialog');
  const rppInputAfter = dialogAfter.locator('input[type="number"]').first();
  const includeInputAfter = dialogAfter.locator('input[type="text"]').first();
  
  await expect(rppInputAfter).toHaveValue(beforeRpp);
  await expect(includeInputAfter).toHaveValue(beforeInc);
});

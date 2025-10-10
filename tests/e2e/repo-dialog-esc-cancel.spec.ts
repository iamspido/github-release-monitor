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

  // Capture current persisted values to compare later
  const beforeRpp = await page.locator('#releases-per-page-repo').inputValue();
  const beforeInc = await page.locator('#include-regex-repo').inputValue();

  // Change some fields but close immediately before autosave debounce (1.5s)
  await page.locator('#releases-per-page-repo').fill('77');
  await page.locator('#include-regex-repo').fill('^v$');
  await page.keyboard.press('Escape');

  // Reopen and ensure values were not saved (empty means global)
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  await expect(page.locator('#releases-per-page-repo')).toHaveValue(beforeRpp);
  await expect(page.locator('#include-regex-repo')).toHaveValue(beforeInc);
});

import { test, expect } from '@playwright/test';
import { waitForAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test('global include/exclude regex reflected as placeholders in repo dialog', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  // Set global include/exclude regex
  await page.goto('/en/settings');
  await page.locator('#include-regex').fill('^foo$');
  await page.locator('#exclude-regex').fill('^bar$');
  await waitForAutosave(page);

  // Open repo dialog and check placeholders
  await page.goto('/en');
  await waitForRepoLink(page);
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  await expect(page.locator('#include-regex-repo')).toHaveAttribute('placeholder', '^foo$');
  await expect(page.locator('#exclude-regex-repo')).toHaveAttribute('placeholder', '^bar$');
});

import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('repo dialog reset filters clears channels/regex and errors', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

  // Open repo settings dialog on first card
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

  // Toggle prerelease to expand subtypes (just to create a non-global state)
  await page.getByLabel('Pre-release').click();
  // Enter invalid regex to trigger error
  await page.locator('#include-regex-repo').fill('([');
  await expect(page.getByText('Invalid regular expression.')).toBeVisible();

  // Click the top section reset icon button (sr-only name is "Reset")
  await page.getByRole('button', { name: 'Reset' }).first().click();

  // Error should disappear and regex input should be cleared
  await expect(page.getByText('Invalid regular expression.')).toHaveCount(0);
  await expect(page.locator('#include-regex-repo')).toHaveValue('');

  // Close dialog
  await page.keyboard.press('Escape');
});

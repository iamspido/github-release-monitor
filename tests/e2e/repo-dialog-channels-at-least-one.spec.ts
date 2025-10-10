import { test, expect } from '@playwright/test';
import { assertNoAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test('repo dialog channels require at least one selected', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

  // Open repo settings dialog on first card
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

  // Attempt to uncheck the only selected global channel (Stable)
  await page.getByLabel('Stable').click();

  await expect(
    page.getByText('At least one release type must be selected when overriding global settings.').first()
  ).toBeVisible();

  // No autosave while failure state
  await assertNoAutosave(page);

  await page.keyboard.press('Escape');
});

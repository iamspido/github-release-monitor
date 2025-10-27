import { test, expect } from '@playwright/test';
import { assertNoAutosave, login, ensureTestRepo } from './utils';

test('repo dialog RPP > 1000 shows error and blocks autosave', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  // Open repo settings dialog on first card
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  const dialog = page.getByRole('dialog');
  const rppInput = dialog.locator('input[type="number"]').first();

  // Set invalid value > 1000
  await rppInput.fill('1001');
  await expect(page.getByText('The number cannot exceed 1000.')).toBeVisible();

  // No autosave while invalid
  await assertNoAutosave(page);

  // Close dialog
  await page.keyboard.press('Escape');
});

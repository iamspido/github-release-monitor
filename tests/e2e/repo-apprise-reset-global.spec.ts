import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';
import { ensureTestRepo } from './utils';

test('repo apprise format/tags reset-to-global buttons restore global hints', async ({ page }) => {
  await ensureAppLocale(page, 'en');
  await ensureTestRepo(page);
  await page.goto('/en');

  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Apprise format: select markdown, then switch back to global via select option
  await page.getByLabel('Global Apprise Format').click();
  await page.getByRole('option', { name: 'Markdown' }).click();

  // Apprise tags: find all text inputs in dialog, apprise tags is the last one
  const dialog = page.getByRole('dialog');
  const allTextInputs = dialog.locator('input[type="text"]');
  const tagsInput = allTextInputs.last();
  
  await tagsInput.fill('foo,bar');

  // Hint should indicate individual settings
  await expect(page.getByText('Using individual Apprise settings.')).toBeVisible();

  // Set format back to global via select option
  await page.getByLabel('Global Apprise Format').click();
  await page.getByRole('option', { name: /Use global/i }).click();
  // Clear tags to mimic reset-to-global
  await tagsInput.fill('');

  // Values should be cleared and hint switches to global
  await expect(tagsInput).toHaveValue('');
  await expect(page.getByText('Using global Apprise settings.')).toBeVisible();
});

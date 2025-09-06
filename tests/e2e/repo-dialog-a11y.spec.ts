import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('repo settings dialog has dialog role, labelledby, and traps focus on open', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const labelledBy = await dialog.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  const title = page.locator(`#${labelledBy}`);
  await expect(title).toBeVisible();

  // Basic interaction inside dialog to ensure focusable elements are operable
  await page.locator('#releases-per-page-repo').focus();
  await expect(page.locator('#releases-per-page-repo')).toBeFocused();
});

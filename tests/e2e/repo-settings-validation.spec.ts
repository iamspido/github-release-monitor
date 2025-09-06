import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('repo settings regex validation shows and clears error', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  // Open settings dialog on the first card
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  // Enter invalid regex
  await page.getByLabel('Include Pattern').fill('([');
  await expect(page.getByText('Invalid regular expression.')).toBeVisible();
  // Enter valid regex
  await page.getByLabel('Include Pattern').fill('^v[0-9]+$');
  await expect(page.getByText('Invalid regular expression.')).toHaveCount(0);
});

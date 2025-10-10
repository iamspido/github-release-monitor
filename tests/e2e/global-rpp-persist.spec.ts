import { test, expect } from '@playwright/test';
import { waitForAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test('global releases-per-page persists and reflects in repo dialog placeholder', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  // Change global RPP to 55
  await page.goto('/en/settings');
  await page.locator('#releases-per-page').fill('55');
  await waitForAutosave(page);

  // Open repo dialog and check placeholder reflects 55
  await page.goto('/en');
  await waitForRepoLink(page);
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  const placeholder = await page.locator('#releases-per-page-repo').getAttribute('placeholder');
  expect(placeholder || '').toMatch(/Global default \(55\)/);

  // Ensure cards render without error
  await page.keyboard.press('Escape');
  await waitForRepoLink(page);
});

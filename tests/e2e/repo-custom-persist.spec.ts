import { test, expect } from '@playwright/test';
import { login, ensureTestRepo, waitForAutosave } from './utils';

test('repo custom settings persist and show badge', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  // Open repo settings dialog and set RPP to 10
  await expect(page.getByText('test/test').first()).toBeVisible();
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  const rppRepo = page.locator('#releases-per-page-repo');
  await rppRepo.fill('10');
  await waitForAutosave(page);

  // Close dialog and verify Custom badge
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Custom$/).first()).toBeVisible();

  // Reload and verify badge persists
  await page.reload();
  await expect(page.getByText(/^Custom$/).first()).toBeVisible();

  // Re-open dialog and verify value persisted
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  await expect(page.locator('#releases-per-page-repo')).toHaveValue('10');
});

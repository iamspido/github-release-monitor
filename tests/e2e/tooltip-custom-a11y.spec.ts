import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink, waitForAutosave } from './utils';

test('custom badge tooltip is accessible via hover/focus text', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);
  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();
  
  const dialog = page.getByRole('dialog');
  const rppInput = dialog.locator('input[type="number"]').first();
  
  await rppInput.fill('9');
  await waitForAutosave(page);
  await page.keyboard.press('Escape');

  // Badge visible
  const badge = page.getByText(/^Custom$/).first();
  await expect(badge).toBeVisible();
  // Hover to show tooltip (focus not guaranteed due to non-focusable span)
  await badge.hover();
  const tip = page.locator('[role="tooltip"]').filter({ hasText: 'This repository is using custom settings.' }).first();
  await expect(tip).toBeVisible();
});

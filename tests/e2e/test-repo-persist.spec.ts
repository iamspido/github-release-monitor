import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('mark as new persists across reload', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);
  // Ensure we are in a state where 'Mark as new' exists; if not, clear 'new' first
  let markAsNew = page.getByRole('button', { name: 'Mark as new' }).first();
  if (!(await markAsNew.isVisible().catch(() => false))) {
    const refreshBtn = page.getByRole('button', { name: 'Refresh' }).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
      await waitForRepoLink(page);
    }
    const markSeenBtn = page.getByRole('button', { name: 'Mark as seen' }).first();
    if (await markSeenBtn.isVisible().catch(() => false)) {
      await markSeenBtn.click();
      await expect(page.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0);
    }
    markAsNew = page.getByRole('button', { name: 'Mark as new' }).first();
  }
  await expect(markAsNew).toBeVisible({ timeout: 8_000 });
  await markAsNew.click();
  // After marking as new, "Mark as seen" appears
  await expect(page.getByRole('button', { name: 'Mark as seen' }).first()).toBeVisible({ timeout: 8_000 });
  // Reload and ensure it still appears
  await page.reload();
  await waitForRepoLink(page);
  await expect(page.getByRole('button', { name: 'Mark as seen' }).first()).toBeVisible({ timeout: 8_000 });
});

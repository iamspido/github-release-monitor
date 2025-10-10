import { test, expect } from '@playwright/test';
import { waitForAutosave, ensureTestRepo, login, waitForRepoLink } from './utils';

test("disabling 'Mark as seen' hides both action buttons", async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  // Make repo 'new' so actions would appear normally
  await page.goto('/en');
  await waitForRepoLink(page);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Mark as seen' }).first()).toBeVisible({ timeout: 10_000 });

  // Disable acknowledge feature
  await page.goto('/en/settings');
  const ackCheckbox = page.getByRole('checkbox', { name: /Enable 'Mark as seen'/i });
  // Ensure it ends up unchecked (feature disabled)
  await ackCheckbox.uncheck();
  await waitForAutosave(page);

  // Back to home
  await page.goto('/en');
  await waitForRepoLink(page);
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as new' })).toHaveCount(0);
  // Restore setting (re-enable) to avoid affecting subsequent tests
  await page.goto('/en/settings');
  await ackCheckbox.check();
  await waitForAutosave(page);
});

test("disabling 'Mark as new' hides only that button when not new", async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);
  // Ensure not-new state: if 'Mark as seen' exists, click it to clear new flag
  const markSeen = page.getByRole('button', { name: 'Mark as seen' }).first();
  if (await markSeen.isVisible().catch(() => false)) {
    await markSeen.click();
  }
  // Ensure we see 'Mark as new' in default config; if not, click refresh then acknowledge to clear new
  const markNewBtn = page.getByRole('button', { name: 'Mark as new' }).first();
  if (!(await markNewBtn.isVisible().catch(() => false))) {
    const refreshBtn = page.getByRole('button', { name: 'Refresh' }).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
    }
    const markSeen2 = page.getByRole('button', { name: 'Mark as seen' }).first();
    if (await markSeen2.isVisible().catch(() => false)) {
      await markSeen2.click();
    }
  }
  await expect(page.getByRole('button', { name: 'Mark as new' }).first()).toBeVisible({ timeout: 10_000 });

  // Disable 'Show Mark as new'
  await page.goto('/en/settings');
  const markNewCheckbox = page.getByRole('checkbox', { name: /Show 'Mark as new' button/i });
  await markNewCheckbox.uncheck();
  await waitForAutosave(page);

  await page.goto('/en');
  await waitForRepoLink(page);
  await expect(page.getByRole('button', { name: 'Mark as new' })).toHaveCount(0);
  // Restore setting (re-enable) for subsequent tests
  await page.goto('/en/settings');
  await markNewCheckbox.check();
  await waitForAutosave(page);
});

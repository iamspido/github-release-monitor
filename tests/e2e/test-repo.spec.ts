import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('setup test repo on Test page and see it on Home', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await expect(page.getByRole('heading', { name: 'System Configuration Test' })).toBeVisible();
  await page.goto('/en');
  await waitForRepoLink(page);
});

test('refresh marks test repo as new, then acknowledge removes the highlight', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);
  // Trigger refresh
  await page.getByRole('button', { name: 'Refresh' }).click();
  // After refresh, ensure the card enters 'new' state; if not, refresh again
  let markAsSeen = page.getByRole('button', { name: 'Mark as seen' }).first();
  if (!(await markAsSeen.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Refresh' }).click();
    markAsSeen = page.getByRole('button', { name: 'Mark as seen' }).first();
  }
  await expect(markAsSeen).toBeVisible({ timeout: 10_000 });
  await markAsSeen.click();
  // Button should disappear once acknowledged
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0);

  // And "Mark as new" should now be visible; toggling should bring back "Mark as seen"
  const markAsNew = page.getByRole('button', { name: 'Mark as new' }).first();
  await expect(markAsNew).toBeVisible({ timeout: 8_000 });
  await markAsNew.click();
  await expect(page.getByRole('button', { name: 'Mark as seen' }).first()).toBeVisible({ timeout: 8_000 });
});

test('remove the test repo via confirm dialog', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  const repoLink = await waitForRepoLink(page);
  // Click Remove on the repo card
  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await expect(removeButton).toBeVisible({ timeout: 10_000 });
  await removeButton.click();
  // Confirm dialog → Confirm
  const alertDialog = page.getByRole('alertdialog');
  await expect(alertDialog).toBeVisible();
  await alertDialog.getByRole('button', { name: 'Confirm' }).click();
  // The repo card should be gone
  await expect(repoLink).toHaveCount(0);
});

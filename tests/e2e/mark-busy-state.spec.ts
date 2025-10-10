import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('mark as new disables button during action and shows toast', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

  // Ensure "Mark as new" is available (make seen first if needed)
  const markSeen = page.getByRole('button', { name: 'Mark as seen' }).first();
  if (await markSeen.isVisible().catch(() => false)) {
    await markSeen.click();
    await expect(page.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0);
  }

  const markNew = page.getByRole('button', { name: 'Mark as new' }).first();
  await expect(markNew).toBeVisible({ timeout: 8_000 });
  await markNew.click();

  // Immediately becomes disabled during transition
  await expect(markNew).toBeDisabled();

  // Toast appears and "Mark as seen" shows after success
  await expect(page.getByText("The repository was successfully marked as 'new'.", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Mark as seen' }).first()).toBeVisible({ timeout: 8_000 });
});

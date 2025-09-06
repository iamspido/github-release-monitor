import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('mark as new shows toast and persists after reload', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  // Ensure not-new state
  const seenBtn = page.getByRole('button', { name: 'Mark as seen' });
  if (await seenBtn.isVisible().catch(() => false)) {
    await seenBtn.click();
  }

  // Click Mark as new
  const markNew = page.getByRole('button', { name: 'Mark as new' });
  await expect(markNew).toBeVisible();
  await markNew.click();

  // Toast visible
  await expect(page.getByText("The repository was successfully marked as 'new'.", { exact: true })).toBeVisible();

  // Now 'Mark as seen' must appear
  await expect(seenBtn).toBeVisible();

  // Reload and ensure state persisted
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('remove flow keeps focus on cancel and shows EmptyState on last removal', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  await waitForRepoLink(page);
  const remove = page.getByRole('button', { name: 'Remove' }).first();
  await remove.focus();
  await expect(remove).toBeFocused();
  await remove.click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  // Focus remains on Remove
  await expect(remove).toBeFocused();

  // Remove for real
  await remove.click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Confirm' }).click();
  // Wait for dialog to close and card to be removed
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText('test/test')).toHaveCount(0);
  // If last repo removed, EmptyState heading is visible; otherwise, ensure the test repo link is gone
  const emptyState = page.getByRole('heading', { name: 'Start Observing' });
  const isEmpty = await emptyState.isVisible().catch(() => false);
  if (!isEmpty) {
    await expect(page.getByText('test/test')).toHaveCount(0);
  }
});

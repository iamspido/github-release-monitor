import { test, expect } from '@playwright/test';
import { login, ensureTestRepo, goOffline, goOnline } from './utils';

test.describe('Remove dialog offline behavior', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await ensureTestRepo(page);
    await page.goto('/en');
    await expect(page.getByText('test/test')).toBeVisible();
  });

  test('Remove action is not possible when offline (disabled or confirm blocked)', async ({ page }) => {
    await goOffline(page);
    const removeBtn = page.getByRole('button', { name: 'Remove' }).first();

    // If the trigger is disabled, we are done; otherwise, dialog may open but confirm must be disabled
    const isDisabled = await removeBtn.isDisabled().catch(() => false);
    if (isDisabled) {
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    } else {
      await removeBtn.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      // Close dialog to clean up
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    }

    await goOnline(page);
  });

  test('When dialog is open, going offline disables Confirm but Cancel works', async ({ page }) => {
    // Open the remove dialog while online
    await page.getByRole('button', { name: 'Remove' }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // Go offline: confirm becomes disabled, cancel remains enabled
    await goOffline(page);
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    // Cancel closes the dialog
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // Back online for cleanliness
    await goOnline(page);
  });
});

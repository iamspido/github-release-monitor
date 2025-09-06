import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('delete-all cancel keeps repositories and shows no success toast', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  await page.goto('/en/settings');
  await page.getByRole('button', { name: 'Delete All Repositories' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Ensure success toast not shown
  await expect(page.getByText('Repositories Deleted')).toHaveCount(0);

  // Go home: repo card still visible
  await page.goto('/en');
  await expect(page.getByText('test/test').first()).toBeVisible();
});

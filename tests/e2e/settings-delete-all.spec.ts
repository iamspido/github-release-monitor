import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('delete all repositories from settings danger zone', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  // Go to settings and delete all
  await page.goto('/en/settings');
  await page.getByRole('button', { name: 'Delete All Repositories' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete everything' }).click();
  // Expect success toast and navigate home
  await expect(page.getByText('Repositories Deleted', { exact: true })).toBeVisible();
  await page.goto('/en');
  // Empty state visible
  await expect(page.getByRole('heading', { name: 'Start Observing' })).toBeVisible();
});

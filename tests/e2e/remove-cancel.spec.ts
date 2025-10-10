import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('remove dialog cancel keeps the repository card', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  const repoLink = await waitForRepoLink(page);
  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await expect(removeButton).toBeVisible({ timeout: 10_000 });
  await removeButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  // Wait for dialog to close to avoid strict mode conflicts
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // Card remains (anchor link to repo)
  await expect(repoLink.first()).toBeVisible();
});

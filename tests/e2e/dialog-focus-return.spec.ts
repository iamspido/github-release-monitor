import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('repo dialog returns focus to trigger on ESC and Close', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  const trigger = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Open again and close via X
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

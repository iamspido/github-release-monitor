import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('mobile: dialog closes on overlay click and focus returns to trigger', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  const trigger = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Click overlay by clicking near top-left corner (overlay covers full viewport)
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => {
    return await trigger.evaluate((el) => document.activeElement === el);
  }, { timeout: 3000, intervals: [100] }).toBe(true);
});

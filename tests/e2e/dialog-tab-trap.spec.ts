import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('repo dialog traps focus with Tab/Shift+Tab', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  const trigger = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Focus first focusable inside dialog (title close button is a good end point)
  await page.getByRole('button', { name: 'Close' }).focus();
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();

  // Press Tab a few times; focus should remain within the dialog
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const isInside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const active = document.activeElement;
      return !!(dlg && active && (active === dlg || dlg.contains(active)));
    });
    expect(isInside).toBe(true);
  }

  // Shift+Tab also remains within dialog
  for (let i = 0; i < 5; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    const isInside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const active = document.activeElement;
      return !!(dlg && active && (active === dlg || dlg.contains(active)));
    });
    expect(isInside).toBe(true);
  }

  // Close via explicit Close button to avoid ESC timing edge cases
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => {
    return await trigger.evaluate((el) => document.activeElement === el);
  }, { timeout: 3000, intervals: [100] }).toBe(true);
});

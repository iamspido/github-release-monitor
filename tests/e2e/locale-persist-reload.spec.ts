import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('locale persists via settings across reloads', async ({ page }) => {
  await ensureAppLocale(page, 'de');
  await page.goto('/');
  await expect(page).toHaveURL(/\/de(\/|$)/);
  await page.reload();
  await expect(page).toHaveURL(/\/de(\/|$)/);
  await ensureAppLocale(page, 'en');
});

import { test, expect } from '@playwright/test';
import { ensureAppLocale, openSettingsForLocale, switchLocaleFromSettings } from './utils/locale';

test('history works across locale switches without duplication', async ({ page }) => {
  try {
    await ensureAppLocale(page, 'en');
    await openSettingsForLocale(page, 'en');
    await switchLocaleFromSettings(page, 'de');
    await expect(page).toHaveURL(/\/de\/einstellungen$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/(en\/settings|de\/?)$/);
    expect(new URL(page.url()).pathname).not.toMatch(/\/(en|de)\/\1(\/|$)/);

    await page.goForward();
    await expect(page).toHaveURL(/\/de\/einstellungen$/);
  } finally {
    await ensureAppLocale(page, 'en');
  }
});

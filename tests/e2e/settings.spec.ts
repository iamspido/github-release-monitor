import { test, expect } from '@playwright/test';
import { ensureAppLocale, openSettingsForLocale, switchLocaleFromSettings } from './utils/locale';

test('switch locale to German via settings', async ({ page }) => {
  await ensureAppLocale(page, 'en');
  await openSettingsForLocale(page, 'en');
  await switchLocaleFromSettings(page, 'de');
  await page.goto('/de/test');
  await expect(page.getByRole('heading', { name: 'Systemkonfigurationstest' })).toBeVisible();
  await ensureAppLocale(page, 'en');
});

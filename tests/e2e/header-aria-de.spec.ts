import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('header button aria-labels are localized in DE', async ({ page }) => {
  await ensureAppLocale(page, 'de');
  await page.goto('/de');
  await expect(page.getByRole('button', { name: 'Zurück zur Startseite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Einstellungen öffnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testseite öffnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();
  await ensureAppLocale(page, 'en');
});

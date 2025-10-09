import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('mobile menu entries are localized in DE', async ({ page }) => {
  await ensureAppLocale(page, 'de');
  await page.setViewportSize({ width: 420, height: 900 });

  // Open mobile menu and assert entries
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(page.getByRole('menuitem', { name: 'Startseite' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Testseite' })).toBeVisible();
  // Logout button exists but not a menuitem with a distinct role name; check presence by name
  await expect(page.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible();
  await ensureAppLocale(page, 'en');
});

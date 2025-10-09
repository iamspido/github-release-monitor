import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('mobile navigation works in DE locale', async ({ page }) => {
  await ensureAppLocale(page, 'de');
  await page.goto('/de/test');

  // Simulate small viewport to show mobile menu
  await page.setViewportSize({ width: 420, height: 900 });

  // Open mobile menu (menu_open in DE)
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  // Navigate to Einstellungen (stays on settings)
  await page.getByRole('menuitem', { name: 'Einstellungen' }).click();
  await expect(page).toHaveURL(/\/de\/einstellungen$/);

  // Open menu and go to Testseite
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Testseite' }).click();
  await expect(page).toHaveURL(/\/de\/test$/);
  await expect(page.getByRole('heading', { name: 'Systemkonfigurationstest' })).toBeVisible();

  // Open menu and go to Startseite
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Startseite' }).click();
  await expect(page).toHaveURL(/\/de(\/)?$/);

  await ensureAppLocale(page, 'en');
});

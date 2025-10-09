import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('back-to-top appears after scroll and uses i18n label', async ({ page }) => {
  await ensureAppLocale(page, 'en');
  await page.goto('/en');

  await page.evaluate(() => window.scrollTo(0, 1000));
  const btn = page.getByRole('button', { name: 'Scroll to top' });
  await expect(btn).toBeVisible();
  await btn.click();
  // Smooth scroll can take a bit; poll until near top
  await expect.poll(async () => {
    return await page.evaluate(() => window.scrollY);
  }, { timeout: 2000, intervals: [100] }).toBeLessThan(30);

  // DE label
  await ensureAppLocale(page, 'de');
  await page.goto('/de');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect(page.getByRole('button', { name: 'Nach oben scrollen' })).toBeVisible();

  await ensureAppLocale(page, 'en');
});

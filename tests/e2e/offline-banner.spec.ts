import { test, expect } from '@playwright/test';
import { goOffline, goOnline, login } from './utils';
import { ensureAppLocale } from './utils/locale';

const EN_TITLE = "You're offline.";
const DE_TITLE = 'Sie sind offline.';

test.describe('Offline banner behavior', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('appears on offline, sticky, and hides on online (EN)', async ({ page }) => {
    await ensureAppLocale(page, 'en');
    await page.goto('/en');

    // Toggle offline to show the banner
    await goOffline(page);
    const banner = page.getByText(EN_TITLE);
    const container = page.locator('header').locator('div[aria-live="polite"]');
    // Wait until banner area has height > 0 (visible region)
    await expect.poll(async () => await container.evaluate(el => el.getBoundingClientRect().height), { timeout: 3000, intervals: [200] }).toBeGreaterThan(0);
    await expect(banner).toBeVisible();

    // Scroll and ensure still visible (sticky)
    await page.evaluate(() => window.scrollTo(0, 1000));
    await expect(banner).toBeVisible();

    // Back online, banner hides again
    await goOnline(page);
    // Wait until banner area collapses; allow 1px tolerance for border
    await expect.poll(async () => await container.evaluate(el => el.getBoundingClientRect().height), { timeout: 3000, intervals: [200] }).toBeLessThan(2);
  });

  test('appears on offline and hides on online (DE)', async ({ page }) => {
    await ensureAppLocale(page, 'de');
    await page.goto('/de');
    await goOffline(page);
    const container = page.locator('header').locator('div[aria-live="polite"]');
    await expect.poll(async () => await container.evaluate(el => el.getBoundingClientRect().height), { timeout: 3000, intervals: [200] }).toBeGreaterThan(0);
    await expect(page.getByText(DE_TITLE)).toBeVisible();
    await goOnline(page);
    await expect.poll(async () => await container.evaluate(el => el.getBoundingClientRect().height), { timeout: 3000, intervals: [200] }).toBeLessThan(2);
    await ensureAppLocale(page, 'en');
  });
});

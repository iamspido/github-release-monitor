import { test, expect } from '@playwright/test';
import { ensureTestRepo } from './utils';
import { ensureAppLocale } from './utils/locale';

test('release card shows time labels in EN and DE', async ({ page }) => {
  await ensureAppLocale(page, 'en');
  await ensureTestRepo(page);

  await page.goto('/en');
  await expect(page.getByText(/Released\s+/)).toBeVisible();
  await expect(page.getByText(/Checked\s+/)).toBeVisible();

  await ensureAppLocale(page, 'de');
  await page.goto('/de');
  await expect(page.getByText(/Veröffentlicht\s+/)).toBeVisible();
  await expect(page.getByText(/Geprüft\s+/)).toBeVisible();

  await ensureAppLocale(page, 'en');
});

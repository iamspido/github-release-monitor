import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

test('settings locale overrides NEXT_LOCALE cookie', async ({ page, context }) => {
  await ensureAppLocale(page, 'en');
  await context.addCookies([
    {
      name: 'NEXT_LOCALE',
      value: 'de',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/en(\/|$)/);

  await ensureAppLocale(page, 'de');
  await page.goto('/');
  await expect(page).toHaveURL(/\/de(\/|$)/);
});

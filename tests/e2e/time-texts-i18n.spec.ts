import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('release card shows time labels in EN and DE', async ({ page, context }) => {
  await login(page);
  await ensureTestRepo(page);

  await page.goto('/en');
  await expect(page.getByText(/Released\s+/)).toBeVisible();
  await expect(page.getByText(/Checked\s+/)).toBeVisible();

  // Switch to DE and verify localized labels
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);
  await page.goto('/');
  await expect(page.getByText(/Veröffentlicht\s+/)).toBeVisible();
  await expect(page.getByText(/Geprüft\s+/)).toBeVisible();
});

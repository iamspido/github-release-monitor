import { test, expect } from '@playwright/test';

test('setup endpoint stays disabled after bootstrap', async ({ page }) => {
  const response = await page.request.get('/api/auth/setup', {
    headers: { 'cache-control': 'no-store' },
  });
  expect(response.status()).toBe(404);
});

test('login page does not show setup form after bootstrap', async ({ page }) => {
  await page.goto('/en/login');
  await expect(page.locator('input[name="setupToken"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /login|anmelden/i })).toBeVisible();
});

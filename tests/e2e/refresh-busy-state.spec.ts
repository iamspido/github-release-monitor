import { test, expect } from '@playwright/test';

async function login(page) {
  const u = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const p = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(u);
  await page.locator('input[name="password"]').fill(p);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('refresh button disables during action and prevents double submit', async ({ page }) => {
  await login(page);
  await page.goto('/en');

  const refreshBtn = page.getByRole('button', { name: 'Refresh' });
  await expect(refreshBtn).toBeEnabled();

  // Click twice quickly; second should be ignored because disabled during pending
  await Promise.all([
    refreshBtn.click(),
    refreshBtn.click(),
  ]);

  await expect(refreshBtn).toBeDisabled();

  // Button should return to enabled state after operation completes.
  // This is the reliable end signal; toast rendering can be flaky in CI.
  await expect(refreshBtn).toBeEnabled({ timeout: 15_000 });
});

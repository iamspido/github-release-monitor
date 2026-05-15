import { test, expect } from '@playwright/test';

test('mobile header menu closes after navigation; back works', async ({ page }) => {
  const u = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const p = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(u);
  await page.locator('input[name="password"]').fill(p);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  await page.goto('/en/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Test Page' }).click();
  await expect(page).toHaveURL(/\/en\/test$/);
  // Menu closed
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Back to settings
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/settings$/);
});


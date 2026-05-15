import { test, expect } from '@playwright/test';

test('mobile logout via menu and route protection', async ({ page }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.setViewportSize({ width: 420, height: 900 });

  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Open mobile menu and click Logout
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();

  await expect(page).toHaveURL(/\/en\/login$/);

  // Route protection after logout
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});


import { test, expect } from '@playwright/test';

test('mobile logout via menu and route protection', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.setViewportSize({ width: 420, height: 900 });

  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Open mobile menu and click Logout
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();

  await expect(page).toHaveURL(/\/en\/login$/);

  // Route protection after logout
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login(\?.*)?$/);
});


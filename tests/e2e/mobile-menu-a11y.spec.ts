import { test, expect } from '@playwright/test';

test('mobile menu a11y attributes and roles', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.setViewportSize({ width: 420, height: 900 });

  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const trigger = page.getByRole('button', { name: 'Open menu' });
  await trigger.click();

  // Menu has role=menu and items role=menuitem
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Test Page' })).toBeVisible();

  // ESC closes menu
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

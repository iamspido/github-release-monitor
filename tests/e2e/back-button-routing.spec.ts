import { test, expect } from '@playwright/test';

test('history works across locale switches without duplication', async ({ page }) => {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // EN settings
  await page.goto('/en/settings');
  // Switch to DE settings via language select
  await expect(page.locator('#language-select')).toBeVisible();
  await page.locator('#language-select').click();
  await page.getByRole('option', { name: 'German' }).click();
  await page.goto('/de/einstellungen');
  await expect(page).toHaveURL(/\/de\/einstellungen$/);

  // Back to EN settings
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/settings$/);
  // Forward to DE settings
  await page.goForward();
  await expect(page).toHaveURL(/\/de\/einstellungen$/);
});

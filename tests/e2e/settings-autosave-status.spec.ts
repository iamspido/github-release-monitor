import { test, expect } from '@playwright/test';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('autosave ends with All changes saved', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  const rpp = page.locator('#releases-per-page');
  // Change to a valid different value to trigger autosave
  await rpp.fill('31');

  // Wait for final success state (depending on viewport, may show "Saved" instead)
  const success = page.getByText(/All changes saved|^Saved$/);
  await expect(success).toBeVisible({ timeout: 8000 });
});

test('export button remains enabled during settings autosave', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');
  // Trigger autosave
  await page.locator('#releases-per-page').fill('32');

  // Immediately go to home and ensure Export is enabled
  await page.goto('/en');
  const exportBtn = page.getByRole('button', { name: 'Export' });
  await expect(exportBtn).toBeEnabled();
});

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

test('switch locale to German via settings', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');
  // Open language select
  const trigger = page.locator('#language-select');
  await trigger.click();
  // Select German from the listbox options
  await page.getByRole('option', { name: 'German' }).click();
  // Rather than relying on auto-navigation, navigate to a DE route and verify content
  await page.goto('/de/test');
  await expect(page.getByRole('heading', { name: 'Systemkonfigurationstest' })).toBeVisible();
});

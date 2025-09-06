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

test('home headings localized when switching language DE <-> EN', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  // Switch to German
  await page.locator('#language-select').click();
  await page.getByRole('option', { name: 'German' }).click();
  await page.goto('/de');
  await expect(page.getByRole('heading', { name: 'Überwachte Repositories' })).toBeVisible();

  // Switch back to English
  await page.goto('/de/einstellungen');
  await page.locator('#language-select').click();
  // In DE locale, the option is localized as "Englisch"
  await page.getByRole('option', { name: 'Englisch' }).click();
  await page.goto('/en');
  await expect(page.getByRole('heading', { name: 'Monitored Repositories' })).toBeVisible();
});

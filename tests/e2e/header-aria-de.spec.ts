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

test('header button aria-labels are localized in DE', async ({ page }) => {
  await login(page);
  // Switch to DE and wait for autosave
  await page.goto('/en/settings');
  await page.locator('#language-select').click();
  await page.getByRole('option', { name: 'German' }).click();
  // Navigate to the DE settings route to assert ARIA labels in German
  await page.goto('/de/einstellungen');

  // Assert German accessible names
  await expect(page.getByRole('button', { name: 'Zurück zur Startseite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Einstellungen öffnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testseite öffnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();
});

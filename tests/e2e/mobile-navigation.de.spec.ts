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

test('mobile navigation works in DE locale', async ({ page }) => {
  await login(page);

  // Switch to German locale via settings
  await page.goto('/en/settings');
  await page.locator('#language-select').click();
  await page.getByRole('option', { name: 'German' }).click();
  // Navigate to a DE route explicitly to be deterministic
  await page.goto('/de/test');

  // Simulate small viewport to show mobile menu
  await page.setViewportSize({ width: 420, height: 900 });

  // Open mobile menu (menu_open in DE)
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  // Navigate to Einstellungen (stays on settings)
  await page.getByRole('menuitem', { name: 'Einstellungen' }).click();
  await expect(page).toHaveURL(/\/de\/einstellungen$/);

  // Open menu and go to Testseite
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Testseite' }).click();
  await expect(page).toHaveURL(/\/de\/test$/);
  await expect(page.getByRole('heading', { name: 'Systemkonfigurationstest' })).toBeVisible();

  // Open menu and go to Startseite
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Startseite' }).click();
  await expect(page).toHaveURL(/\/de(\/)?$/);
});

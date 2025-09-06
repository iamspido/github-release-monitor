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

test('mobile menu entries are localized in DE', async ({ page, context }) => {
  await login(page);
  await page.setViewportSize({ width: 420, height: 900 });

  // Force DE locale via cookie for stability
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/de(\/|$)/);

  // Open mobile menu and assert entries
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(page.getByRole('menuitem', { name: 'Startseite' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Testseite' })).toBeVisible();
  // Logout button exists but not a menuitem with a distinct role name; check presence by name
  await expect(page.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible();
});


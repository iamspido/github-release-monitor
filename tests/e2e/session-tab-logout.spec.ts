import { test, expect } from '@playwright/test';

test('logout in one tab protects the other tab', async ({ browser, context, page }) => {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';

  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Open second tab (inherits session in same context)
  const page2 = await context.newPage();
  await page2.goto('/en');
  await expect(page2.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();

  // Logout from tab 1
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);

  // Any navigation in tab 2 should redirect to login
  await page2.goto('/en');
  await expect(page2).toHaveURL(/\/en\/login(\?.*)?$/);
});


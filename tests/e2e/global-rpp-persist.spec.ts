import { test, expect } from '@playwright/test';
import { waitForAutosave } from './utils';

async function loginAndEnsureRepo(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('global releases-per-page persists and reflects in repo dialog placeholder', async ({ page }) => {
  await loginAndEnsureRepo(page);

  // Change global RPP to 55
  await page.goto('/en/settings');
  await page.locator('#releases-per-page').fill('55');
  await waitForAutosave(page);

  // Open repo dialog and check placeholder reflects 55
  await page.goto('/en');
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  const placeholder = await page.locator('#releases-per-page-repo').getAttribute('placeholder');
  expect(placeholder || '').toMatch(/Global default \(55\)/);

  // Ensure cards render without error
  await page.keyboard.press('Escape');
  await expect(page.getByText('test/test').first()).toBeVisible();
});

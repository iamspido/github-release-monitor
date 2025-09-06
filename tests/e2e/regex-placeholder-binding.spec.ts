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

test('global include/exclude regex reflected as placeholders in repo dialog', async ({ page }) => {
  await loginAndEnsureRepo(page);

  // Set global include/exclude regex
  await page.goto('/en/settings');
  await page.locator('#include-regex').fill('^foo$');
  await page.locator('#exclude-regex').fill('^bar$');
  await waitForAutosave(page);

  // Open repo dialog and check placeholders
  await page.goto('/en');
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  await expect(page.locator('#include-regex-repo')).toHaveAttribute('placeholder', '^foo$');
  await expect(page.locator('#exclude-regex-repo')).toHaveAttribute('placeholder', '^bar$');
});

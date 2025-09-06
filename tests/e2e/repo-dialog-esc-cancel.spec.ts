import { test, expect } from '@playwright/test';

async function loginAndEnsureRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('repo dialog ESC closes without saving pending changes', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  // Open repo dialog
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Capture current persisted values to compare later
  const beforeRpp = await page.locator('#releases-per-page-repo').inputValue();
  const beforeInc = await page.locator('#include-regex-repo').inputValue();

  // Change some fields but close immediately before autosave debounce (1.5s)
  await page.locator('#releases-per-page-repo').fill('77');
  await page.locator('#include-regex-repo').fill('^v$');
  await page.keyboard.press('Escape');

  // Reopen and ensure values were not saved (empty means global)
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  await expect(page.locator('#releases-per-page-repo')).toHaveValue(beforeRpp);
  await expect(page.locator('#include-regex-repo')).toHaveValue(beforeInc);
});

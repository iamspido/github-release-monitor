import { test, expect } from '@playwright/test';
import { assertNoAutosave } from './utils';

async function login(page) {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('global release channels require at least one selected', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');

  // Trying to uncheck the only selected channel should show a toast and not save
  const stable = page.getByLabel('Stable');
  await stable.click();

  await expect(page.getByText('At least one release type must be selected.').first()).toBeVisible();
  await assertNoAutosave(page);
});

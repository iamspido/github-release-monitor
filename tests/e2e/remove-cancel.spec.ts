import { test, expect } from '@playwright/test';

async function loginAndEnsureRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  // Ensure test repo exists
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('remove dialog cancel keeps the repository card', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');
  await expect(page.getByText('test/test')).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  // Wait for dialog to close to avoid strict mode conflicts
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // Card remains (anchor link to repo)
  await expect(page.locator('a', { hasText: 'test/test' })).toBeVisible();
});

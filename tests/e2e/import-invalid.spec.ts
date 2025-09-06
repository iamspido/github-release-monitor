import { test, expect } from '@playwright/test';
import path from 'node:path';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('import invalid-format JSON shows error toast', async ({ page }) => {
  await login(page);
  await page.goto('/en');
  const fileInput = page.locator('input[type="file"][accept=".json"]');
  const invalidPath = path.resolve(__dirname, 'fixtures', 'invalid-format.json');
  await fileInput.setInputFiles(invalidPath);
  await expect(page.getByText('Import Failed')).toBeVisible();
});


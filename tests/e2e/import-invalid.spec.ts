import { test, expect } from '@playwright/test';
import path from 'node:path';

async function login(page) {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('import invalid-format JSON shows error toast', async ({ page }) => {
  await login(page);
  await page.goto('/en');
  const fileInput = page.locator('input[type="file"][accept=".json"]');
  const invalidPath = path.resolve(__dirname, 'fixtures', 'invalid-format.json');
  await fileInput.setInputFiles(invalidPath);
  await expect(page.getByText('Import Failed', { exact: true })).toBeVisible();
});

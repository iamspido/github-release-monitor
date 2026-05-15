import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function login(page) {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('export on empty list yields []', async ({ page }) => {
  await login(page);
  // Delete all repositories first
  await page.goto('/en/settings');
  await page.getByRole('button', { name: 'Delete All Repositories' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(page.getByText('Repositories Deleted', { exact: true })).toBeVisible();

  await page.goto('/en');
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const tmp = '/tmp/export-empty.json';
  await download.saveAs(tmp);
  const content = fs.readFileSync(tmp, 'utf8');
  const json = JSON.parse(content);
  expect(Array.isArray(json)).toBeTruthy();
  expect(json.length).toBe(0);
});


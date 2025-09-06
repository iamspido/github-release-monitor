import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('export repositories initiates download with content', async ({ page, context }) => {
  await login(page);
  // Ensure we have at least one repository to export
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  await expect(page.getByText("The 'test/test' repository is now ready.", { exact: true })).toBeVisible();
  await page.goto('/en');
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const tmp = '/tmp/export-repos.json';
  await download.saveAs(tmp);
  const stat = fs.statSync(tmp);
  expect(stat.size).toBeGreaterThan(1);
  const content = fs.readFileSync(tmp, 'utf8');
  const json = JSON.parse(content);
  expect(Array.isArray(json)).toBeTruthy();
  expect(json.length).toBeGreaterThan(0);
  const suggested = download.suggestedFilename();
  expect(suggested.toLowerCase()).toMatch(/\.json$/);
});

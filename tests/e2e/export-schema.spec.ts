import { test, expect } from '@playwright/test';
import fs from 'node:fs';

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

test('export JSON schema has expected fields', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const tmp = '/tmp/export-schema.json';
  await download.saveAs(tmp);
  const content = fs.readFileSync(tmp, 'utf8');
  const json = JSON.parse(content);
  expect(Array.isArray(json)).toBeTruthy();
  expect(json.length).toBeGreaterThan(0);
  for (const item of json) {
    expect(typeof item.id).toBe('string');
    expect(typeof item.url).toBe('string');
    expect(item.url).toMatch(/^https:\/\/github.com\//);
    if (item.latestRelease) {
      expect(typeof item.latestRelease.tag_name).toBe('string');
      expect(typeof item.latestRelease.html_url).toBe('string');
    }
  }
});


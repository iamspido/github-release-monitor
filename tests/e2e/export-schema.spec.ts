import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('export JSON schema has expected fields', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

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

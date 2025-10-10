import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('export repositories initiates download with content', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);
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

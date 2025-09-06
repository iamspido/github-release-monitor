import { test, expect } from '@playwright/test';
import { login } from './utils';
import fs from 'node:fs';

test('export sets application/json blob type and file name', async ({ page }) => {
  await login(page);

  // Inject hooks to capture Blob type and anchor download name
  await page.addInitScript(() => {
    const orig = URL.createObjectURL;
    (window as any).__lastBlobType = null;
    URL.createObjectURL = function(blob: Blob) {
      (window as any).__lastBlobType = blob.type;
      return orig.call(this, blob);
    } as any;

    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      (window as any).__lastDownloadName = this.download;
      return origClick.call(this);
    } as any;
  });

  await page.goto('/en');
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const suggested = download.suggestedFilename();
  expect(suggested).toBe('repositories.json');

  const blobType = await page.evaluate(() => (window as any).__lastBlobType);
  expect(blobType).toBe('application/json');

  const dlName = await page.evaluate(() => (window as any).__lastDownloadName);
  expect(dlName).toBe('repositories.json');
});

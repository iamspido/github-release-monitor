import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('release markdown renders table, code, links, and emojis', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);

  await page.goto('/en');
  await waitForRepoLink(page);

  // Work within the markdown content container
  const content = page.locator('.prose').first();
  await expect(content.getByRole('heading', { name: 'Full Markdown Test Release' })).toBeVisible();

  // Table exists and has expected header cell (ReactMarkdown may expose <th> as role=cell)
  await expect(content.locator('table')).toBeVisible();
  await expect(content.getByRole('cell', { name: 'Feature' }).first()).toBeVisible();

  // Code block contains function signature
  await expect(content.locator('pre')).toContainText('function greet(name)');

  // Link to Markdown Guide exists
  const mdLink = content.locator('a[href*="markdownguide"]');
  await expect(mdLink).toBeVisible();

  // Emojis present
  await expect(content).toContainText('✨');
  await expect(content).toContainText('🚀');
  await expect(content).toContainText('💡');
});

import { test, expect } from '@playwright/test';

async function loginAndSetupTestRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('release markdown renders table, code, links, and emojis', async ({ page }) => {
  await loginAndSetupTestRepo(page);

  await page.goto('/en');

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

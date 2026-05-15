import { test, expect } from '@playwright/test';

test('title and description are localized on EN routes', async ({ page }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  for (const path of ['/en', '/en/settings', '/en/test']) {
    await page.goto(path);
    await expect(page).toHaveTitle('GitHub Release Monitor');
    const desc = await page.locator('head meta[name="description"]').getAttribute('content');
    expect(desc).toBe('Monitor GitHub releases with ease.');
  }
});

test('title and description are localized on DE routes', async ({ page, context }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);
  await page.goto('/');
  for (const path of ['/de', '/de/einstellungen', '/de/test']) {
    await page.goto(path);
    await expect(page).toHaveTitle('GitHub Release Monitor');
    const desc = await page.locator('head meta[name="description"]').getAttribute('content');
    expect(desc).toBe('Überwachen Sie GitHub-Releases mit Leichtigkeit.');
  }
});

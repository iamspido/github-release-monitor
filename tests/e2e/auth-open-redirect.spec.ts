import { test, expect } from '@playwright/test';

test('open redirect is prevented and lands on app root', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login?next=https://evil.com');
  await page.getByLabel(/email|e-mail/i).fill(process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com');
  await page.locator('input[name="password"]').fill(process.env.AUTH_PASSWORD || 'TestPassword123');
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await expect(page.getByRole('heading', { name: 'GitHub Release Monitor' })).toBeVisible();
});


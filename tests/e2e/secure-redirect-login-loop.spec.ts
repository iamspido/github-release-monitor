import { test, expect } from '@playwright/test';

test('visiting login with next while logged in redirects to home (loop prevention)', async ({ page }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Now try to access login with a next parameter; middleware should redirect to /{locale}
  await page.goto('/en/login?next=/en/test');
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
});


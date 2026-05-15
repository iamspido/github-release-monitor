import { test, expect } from '@playwright/test';

async function login(page) {
  const u = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const p = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(u);
  await page.locator('input[name="password"]').fill(p);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

function getLastUpdatedText(page) {
  return page.locator('text=Last updated:');
}

test('Refresh updates last-updated and shows stable toast', async ({ page }) => {
  await login(page);
  await page.goto('/en');
  const before = await getLastUpdatedText(page).first().textContent();

  // Wait at least one second to avoid same-second timestamps, then refresh
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  // Expect toast (role=status) visible with matching text
  const toast = page.getByRole('status').filter({ hasText: /Refreshed|Successfully refreshed\./i });
  await expect(toast.first()).toBeVisible();

  // Poll until Last updated text changes
  await expect.poll(async () => {
    return await getLastUpdatedText(page).first().textContent();
  }, { timeout: 5000, intervals: [200] }).not.toBe(before);
});

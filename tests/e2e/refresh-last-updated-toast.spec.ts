import { test, expect } from '@playwright/test';

async function login(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
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

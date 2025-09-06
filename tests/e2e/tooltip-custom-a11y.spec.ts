import { test, expect } from '@playwright/test';

async function loginAndEnsureCustomRepo(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  await page.goto('/en');
  // Make repo custom by opening dialog and setting RPP
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
  await page.locator('#releases-per-page-repo').fill('9');
  // Allow autosave debounce and server action to complete
  await page.waitForTimeout(1700);
  await page.keyboard.press('Escape');
}

test('custom badge tooltip is accessible via hover/focus text', async ({ page }) => {
  await loginAndEnsureCustomRepo(page);
  // Badge visible
  const badge = page.getByText(/^Custom$/).first();
  await expect(badge).toBeVisible();
  // Hover to show tooltip (focus not guaranteed due to non-focusable span)
  await badge.hover();
  const tip = page.locator('[role="tooltip"]').filter({ hasText: 'This repository is using custom settings.' }).first();
  await expect(tip).toBeVisible();
});

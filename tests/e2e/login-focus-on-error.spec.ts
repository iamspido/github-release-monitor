import { test, expect } from '@playwright/test';

test('invalid login focuses the first field and shows error', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill('wrong@example.com');
  await page.locator('input[name="password"]').fill('wrong');
  await page.locator('button[type="submit"]').first().click();

  // Error message visible
  await expect(page.getByText('Invalid credentials. Please try again.')).toBeVisible();
  // Password cleared
  await expect(page.locator('input[name="password"]')).toHaveValue('');
  // Username is focused (first field)
  await expect(page.getByLabel(/email|e-mail/i)).toBeFocused();
});

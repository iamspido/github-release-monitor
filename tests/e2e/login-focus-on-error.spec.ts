import { test, expect } from '@playwright/test';

test('invalid login focuses the first field and shows error', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login');
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();

  // Error message visible
  await expect(page.getByText('Invalid credentials. Please try again.')).toBeVisible();
  // Password cleared
  await expect(page.getByLabel('Password')).toHaveValue('');
  // Username is focused (first field)
  await expect(page.getByLabel('Username')).toBeFocused();
});


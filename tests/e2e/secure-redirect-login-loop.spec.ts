import { test, expect } from '@playwright/test';

test('visiting login with next while logged in redirects to home (loop prevention)', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Now try to access login with a next parameter; middleware should redirect to /{locale}
  await page.goto('/en/login?next=/en/test');
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
});


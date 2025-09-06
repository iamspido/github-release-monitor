import { test, expect } from '@playwright/test';

test('header GitHub link has target and rel', async ({ page }) => {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const link = page.getByRole('link', { name: 'View source on GitHub' });
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = await link.getAttribute('rel');
  expect(rel?.includes('noopener')).toBeTruthy();
  expect(rel?.includes('noreferrer')).toBeTruthy();
});


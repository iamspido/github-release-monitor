import { test, expect } from '@playwright/test';

test('header GitHub link has target and rel', async ({ page }) => {
  const username = process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const password = process.env.AUTH_PASSWORD || 'TestPassword123';
  await page.goto('/en/login');
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  const link = page.getByRole('link', { name: 'View source on GitHub' });
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = await link.getAttribute('rel');
  expect(rel?.includes('noopener')).toBeTruthy();
  expect(rel?.includes('noreferrer')).toBeTruthy();
});


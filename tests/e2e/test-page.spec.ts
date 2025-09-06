import { test, expect } from '@playwright/test';

async function login(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('apprise not configured notice and disabled actions', async ({ page }) => {
  await login(page);
  await page.goto('/en/test');
  await expect(page.getByText('Apprise is not configured.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Status' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send Test Notification' })).toBeDisabled();
  // "Trigger Check" requires at least one notification service
  await expect(page.getByRole('button', { name: 'Trigger Check' })).toBeDisabled();
});

test('send direct test email button is disabled without SMTP config', async ({ page }) => {
  await login(page);
  await page.goto('/en/test');
  const btn = page.getByRole('button', { name: 'Send Direct Test Email' });
  await expect(btn).toBeDisabled();
});

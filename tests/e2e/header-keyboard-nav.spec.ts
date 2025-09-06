import { test, expect } from '@playwright/test';
import { login } from './utils';

test('header active state follows route', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  const homeBtn = page.getByRole('button', { name: 'Back to home page' });
  const settingsBtn = page.getByRole('button', { name: 'Open settings page' });
  const testBtn = page.getByRole('button', { name: 'Open test page' });

  // Active state background: navigate to each route and check active button class
  await page.goto('/en');
  await expect(homeBtn).toHaveClass(/bg-secondary/);

  await page.goto('/en/settings');
  await expect(settingsBtn).toHaveClass(/bg-secondary/);

  await page.goto('/en/test');
  await expect(testBtn).toHaveClass(/bg-secondary/);
});

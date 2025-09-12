import { test, expect } from '@playwright/test';
import { login, ensureTestRepo, goOffline, goOnline } from './utils';

test.describe('Offline actions disabled', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Home: Refresh and Export disabled offline; Header logout disabled', async ({ page }) => {
    await page.goto('/en');
    const refresh = page.getByRole('button', { name: 'Refresh' });
    const exportBtn = page.getByRole('button', { name: 'Export' });
    await expect(refresh).toBeEnabled();
    await expect(exportBtn).toBeEnabled();

    await goOffline(page);
    await expect(refresh).toBeDisabled();
    await expect(exportBtn).toBeDisabled();

    // Header logout button should be disabled
    const logout = page.getByRole('button', { name: 'Log out' });
    await expect(logout).toBeDisabled();

    await goOnline(page);
    await expect(refresh).toBeEnabled();
    await expect(exportBtn).toBeEnabled();
  });

  test('Repo form: add/import disabled offline', async ({ page }) => {
    await page.goto('/en');
    const importBtn = page.getByRole('button', { name: 'Import' });
    const addBtn = page.getByRole('button', { name: 'Add Repositories' });
    await expect(importBtn).toBeEnabled();
    await expect(addBtn).toBeDisabled(); // disabled until urls present
    await page.locator('textarea[name="urls"]').fill('https://github.com/test/test');
    await expect(addBtn).toBeEnabled();

    await goOffline(page);
    await expect(importBtn).toBeDisabled();
    await expect(addBtn).toBeDisabled();

    await goOnline(page);
  });

  test('Test page: actions disabled offline', async ({ page }) => {
    await page.goto('/en/test');
    const sendEmail = page.getByRole('button', { name: 'Send Direct Test Email' });
    const setupRepo = page.getByRole('button', { name: 'Add/Reset Test Repo' });
    const triggerCheck = page.getByRole('button', { name: 'Trigger Check' });
    const refreshStatus = page.getByRole('button', { name: 'Refresh Status' });
    const sendApprise = page.getByRole('button', { name: 'Send Test Notification' });

    // If SMTP is not configured, this button is disabled by design
    const smtpConfigured = await page
      .getByText('Email variables are configured.')
      .isVisible()
      .catch(() => false);
    if (smtpConfigured) {
      await expect(sendEmail).toBeEnabled();
    } else {
      await expect(sendEmail).toBeDisabled();
    }
    await expect(setupRepo).toBeEnabled();
    // One of the notification services may be misconfigured — allow disabled then
    await goOffline(page);
    await expect(sendEmail).toBeDisabled();
    await expect(setupRepo).toBeDisabled();
    await expect(triggerCheck).toBeDisabled();
    await expect(refreshStatus).toBeDisabled();
    await expect(sendApprise).toBeDisabled();
    await goOnline(page);
  });
});

import { test, expect } from '@playwright/test';

async function loginAndEnsureRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  // Ensure test repo exists
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('mark as new persists across reload', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');
  await expect(page.getByText('test/test').first()).toBeVisible();
  // Ensure we are in a state where 'Mark as new' exists; if not, clear 'new' first
  let markAsNew = page.getByRole('button', { name: 'Mark as new' });
  if (!(await markAsNew.isVisible().catch(() => false))) {
    const refreshBtn = page.getByRole('button', { name: 'Refresh' });
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
    }
    const markSeenBtn = page.getByRole('button', { name: 'Mark as seen' });
    if (await markSeenBtn.isVisible().catch(() => false)) {
      await markSeenBtn.click();
    }
    markAsNew = page.getByRole('button', { name: 'Mark as new' });
  }
  await expect(markAsNew).toBeVisible();
  await markAsNew.click();
  // After marking as new, "Mark as seen" appears
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toBeVisible();
  // Reload and ensure it still appears
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toBeVisible();
});

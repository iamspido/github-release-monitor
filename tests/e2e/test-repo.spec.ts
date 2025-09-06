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

test('setup test repo on Test page and see it on Home', async ({ page }) => {
  await login(page);
  await page.goto('/en/test');
  await expect(page.getByRole('heading', { name: 'System Configuration Test' })).toBeVisible();
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  // Go to home and expect the repo card to exist
  await page.goto('/en');
  await expect(page.getByText('test/test').first()).toBeVisible();
});

test('refresh marks test repo as new, then acknowledge removes the highlight', async ({ page }) => {
  await login(page);
  // Ensure test repo exists
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();

  await page.goto('/en');
  await expect(page.getByText('test/test').first()).toBeVisible();
  // Trigger refresh
  await page.getByRole('button', { name: 'Refresh' }).click();
  // After refresh, ensure the card enters 'new' state; if not, refresh again
  let markAsSeen = page.getByRole('button', { name: 'Mark as seen' });
  if (!(await markAsSeen.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Refresh' }).click();
    markAsSeen = page.getByRole('button', { name: 'Mark as seen' });
  }
  await expect(markAsSeen).toBeVisible();
  await markAsSeen.click();
  // Button should disappear once acknowledged
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0);

  // And "Mark as new" should now be visible; toggling should bring back "Mark as seen"
  const markAsNew = page.getByRole('button', { name: 'Mark as new' });
  await expect(markAsNew).toBeVisible();
  await markAsNew.click();
  await expect(page.getByRole('button', { name: 'Mark as seen' })).toBeVisible();
});

test('remove the test repo via confirm dialog', async ({ page }) => {
  await login(page);
  // Ensure test repo exists
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  await page.goto('/en');

  // Click Remove on the repo card
  await page.getByRole('button', { name: 'Remove' }).click();
  // Confirm dialog → Confirm
  await page.getByRole('button', { name: 'Confirm' }).click();
  // The repo card should be gone
  await expect(page.getByText('test/test')).toHaveCount(0);
});

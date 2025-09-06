import { test, expect } from '@playwright/test';

async function loginAndEnsureRepo(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('mark as new disables button during action and shows toast', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  // Ensure "Mark as new" is available (make seen first if needed)
  const markSeen = page.getByRole('button', { name: 'Mark as seen' });
  if (await markSeen.isVisible().catch(() => false)) {
    await markSeen.click();
  }

  const markNew = page.getByRole('button', { name: 'Mark as new' });
  await expect(markNew).toBeVisible();
  await markNew.click();

  // Immediately becomes disabled during transition
  await expect(markNew).toBeDisabled();

  // Toast appears and "Mark as seen" shows after success
  await expect(page.getByText("The repository was successfully marked as 'new'.", { exact: true })).toBeVisible();
  await expect(markSeen).toBeVisible();
});


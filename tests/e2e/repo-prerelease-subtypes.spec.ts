import { test, expect } from '@playwright/test';

async function loginAndEnsureRepo(page) {
  const username = process.env.AUTH_USERNAME || 'test';
  const password = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
}

test('pre-release subtypes toggle while keeping parent active', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Enable Pre-release
  const pre = page.getByLabel('Pre-release');
  if (!(await pre.isChecked())) {
    await pre.check();
  }
  // Subtypes should be visible
  await expect(page.getByText('Select the specific pre-release types to monitor.')).toBeVisible();

  // Toggle off all subtype checkboxes (visible in the section)
  const subtypeCheckboxes = page.locator('[id^="prerelease-repo-"][role="checkbox"]');
  const count = await subtypeCheckboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = subtypeCheckboxes.nth(i);
    if (await cb.isChecked()) await cb.click();
  }

  // Parent pre-release checkbox should remain active
  await expect(pre).toBeChecked();
});


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

test('repo dialog reset filters clears channels/regex and errors', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  // Open repo settings dialog on first card
  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Toggle prerelease to expand subtypes (just to create a non-global state)
  await page.getByLabel('Pre-release').click();
  // Enter invalid regex to trigger error
  await page.locator('#include-regex-repo').fill('([');
  await expect(page.getByText('Invalid regular expression.')).toBeVisible();

  // Click the top section reset icon button (sr-only name is "Reset")
  await page.getByRole('button', { name: 'Reset' }).first().click();

  // Error should disappear and regex input should be cleared
  await expect(page.getByText('Invalid regular expression.')).toHaveCount(0);
  await expect(page.locator('#include-regex-repo')).toHaveValue('');

  // Close dialog
  await page.keyboard.press('Escape');
});


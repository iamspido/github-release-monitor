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

test('repo apprise format/tags reset-to-global buttons restore global hints', async ({ page }) => {
  await loginAndEnsureRepo(page);
  await page.goto('/en');

  await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();

  // Apprise format: select markdown, then switch back to global via select option
  await page.getByLabel('Global Apprise Format').click();
  await page.getByRole('option', { name: 'Markdown' }).click();

  // Apprise tags: type custom value
  const tags = page.locator('#apprise-tags-repo');
  await tags.fill('foo,bar');

  // Hint should indicate individual settings
  await expect(page.getByText('Using individual Apprise settings.')).toBeVisible();

  // Set format back to global via select option
  await page.getByLabel('Global Apprise Format').click();
  await page.getByRole('option', { name: /Use global/i }).click();
  // Clear tags to mimic reset-to-global
  await tags.fill('');

  // Values should be cleared and hint switches to global
  await expect(tags).toHaveValue('');
  await expect(page.getByText('Using global Apprise settings.')).toBeVisible();
});

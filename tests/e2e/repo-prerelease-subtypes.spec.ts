import { test, expect } from '@playwright/test';
import { ensureTestRepo, login, waitForRepoLink } from './utils';

test('pre-release subtypes toggle while keeping parent active', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  await waitForRepoLink(page);

  const settingsButton = page.getByRole('button', { name: 'Open settings for this repository' }).first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

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

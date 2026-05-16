import { test, expect } from '@playwright/test';
import { login, waitForAutosave } from './utils';

test('add repositories form collapse state persists and can be restored from settings', async ({ page }) => {
  await login(page);

  await page.goto('/en/settings');
  const setting = page.getByRole('checkbox', {
    name: /Show add repositories form expanded by default/i,
  });
  if (!(await setting.isChecked())) {
    await setting.check();
    await waitForAutosave(page);
  }

  await page.goto('/en');
  const textarea = page.locator('textarea[name="urls"]');
  await expect(textarea).toBeVisible();

  const collapseButton = page.getByRole('button', {
    name: 'Collapse add repositories form',
  });
  await collapseButton.click();
  await expect(textarea).toBeHidden();

  const expandButton = page.getByRole('button', {
    name: 'Expand add repositories form',
  });
  await expect(expandButton).toBeEnabled();

  await page.reload();
  await expect(page.locator('textarea[name="urls"]')).toBeHidden();

  await page.goto('/en/settings');
  await expect(setting).not.toBeChecked();
  await setting.check();
  await waitForAutosave(page);

  await page.goto('/en');
  await expect(page.locator('textarea[name="urls"]')).toBeVisible();
});

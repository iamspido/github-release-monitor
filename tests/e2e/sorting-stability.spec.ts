import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('card order remains stable after toggling new/seen and reload', async ({ page }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');

  // Wait for card to appear
  await expect(page.getByText('test/test').first()).toBeVisible();
  // Record first card text (release title heading in the first card)
  const firstTextBefore = await page.locator('.grid').locator('h2,h3,h4, [role="heading"]').first().textContent();

  // Toggle mark-as-new (if available) or mark-as-seen and then mark-as-new
  const markSeen = page.getByRole('button', { name: 'Mark as seen' });
  if (await markSeen.isVisible().catch(() => false)) {
    await markSeen.click();
  }
  const markNew = page.getByRole('button', { name: 'Mark as new' });
  if (await markNew.isVisible().catch(() => false)) {
    await markNew.click();
  }

  // Check first card remains the same and only one card
  const firstTextAfter = await page.locator('.grid').locator('h2,h3,h4, [role="heading"]').first().textContent();
  expect(firstTextAfter).toBe(firstTextBefore);
  await expect(page.getByText('test/test')).toHaveCount(1);

  // Reload and ensure still the same
  await page.reload();
  const firstTextAfterReload = await page.locator('.grid').locator('h2,h3,h4, [role="heading"]').first().textContent();
  expect(firstTextAfterReload).toBe(firstTextBefore);
});

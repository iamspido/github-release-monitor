import { test, expect } from '@playwright/test';
import { login, ensureTestRepo } from './utils';

test('release card GitHub link opens new tab with rel noopener', async ({ page, context }) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto('/en');
  // Scope to the first release card within the grid to avoid header links
  // Scope to the specific card that contains the repo id text
  const card = page.locator('div').filter({ has: page.getByText('test/test') }).first();
  const link = card.getByRole('link', { name: 'GitHub', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = await link.getAttribute('rel');
  expect(rel?.includes('noopener')).toBeTruthy();
  expect(rel?.includes('noreferrer')).toBeTruthy();

  const urlBefore = page.url();
  const [ newPage ] = await Promise.all([
    context.waitForEvent('page'),
    link.click()
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  // Original page did not navigate
  await expect(page).toHaveURL(urlBefore);
});

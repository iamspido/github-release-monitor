import { test, expect } from '@playwright/test';

test('invalid locale path falls back to cookie locale and preserves cookie', async ({ page, context }) => {
  // Set cookie to DE explicitly
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);

  // Navigate to invalid locale path; middleware should redirect to /de
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/de(\/|$)/);

  // Cookie still de
  const cookies = await context.cookies();
  const c = cookies.find(c => c.name === 'NEXT_LOCALE');
  expect(c?.value).toBe('de');
});


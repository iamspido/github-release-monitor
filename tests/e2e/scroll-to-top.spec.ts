import { test, expect } from '@playwright/test';

async function login(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

test('back-to-top appears after scroll and uses i18n label', async ({ page, context }) => {
  await login(page);
  await page.goto('/en');

  await page.evaluate(() => window.scrollTo(0, 1000));
  const btn = page.getByRole('button', { name: 'Scroll to top' });
  await expect(btn).toBeVisible();
  await btn.click();
  // Smooth scroll can take a bit; poll until near top
  await expect.poll(async () => {
    return await page.evaluate(() => window.scrollY);
  }, { timeout: 2000, intervals: [100] }).toBeLessThan(30);

  // DE label
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'de', domain: 'localhost', path: '/' }]);
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect(page.getByRole('button', { name: 'Nach oben scrollen' })).toBeVisible();
});

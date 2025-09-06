import { test, expect } from '@playwright/test';
import { waitForAutosave } from './utils';

async function login(page) {
  const u = process.env.AUTH_USERNAME || 'test';
  const p = process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

function getLastUpdatedLocator(page) {
  return page.locator('span:text-matches("Last updated:", "i")');
}

test('time format toggles AM/PM in EN and updates in DE', async ({ page, context }) => {
  await login(page);

  // EN: 12h should include AM/PM, 24h should not
  await page.goto('/en/settings');
  await page.getByLabel('12-hour').click();
  await waitForAutosave(page);
  await page.goto('/en');
  const en12 = await getLastUpdatedLocator(page).textContent();
  expect(en12 || '').toMatch(/AM|PM/);

  await page.goto('/en/settings');
  await page.getByLabel('24-hour').click();
  await waitForAutosave(page);
  await page.goto('/en');
  const en24 = await getLastUpdatedLocator(page).textContent();
  expect(en24 || '').not.toMatch(/AM|PM/);
  expect(en24 || '').toMatch(/\d{1,2}:\d{2}/);

  // Switch to DE and verify the string changes between formats (no strict AM/PM assumption)
  await page.goto('/en/settings');
  await page.locator('#language-select').click();
  await page.getByRole('option', { name: 'German' }).click();
  await page.goto('/de/einstellungen');

  // 24h in DE
  await page.getByLabel('24-Stunden').click();
  await page.goto('/de');
  const de24 = await page.locator('span:text-matches("Letzte", "i")').textContent();

  // 12h in DE
  await page.goto('/de/einstellungen');
  await page.getByLabel('12-Stunden').click();
  await waitForAutosave(page);
  await page.goto('/de');
  const de12 = await page.locator('span:text-matches("Letzte", "i")').textContent();
  expect(de12).not.toBe(de24);
});

import { expect, Page, Locator } from '@playwright/test';

// Matches autosave success indicators across EN/DE and short/long variants.
const AUTOSAVE_SUCCESS_LONG_RE = /All changes saved|Alle Änderungen gespeichert/;
const AUTOSAVE_SUCCESS_SHORT_RE = /^Saved$|^Gespeichert$/;
const AUTOSAVE_TOAST_RE = /Settings updated successfully\.|Einstellungen erfolgreich aktualisiert\./;

export async function waitForAutosave(page: Page, timeoutMs = 8000) {
  const candidates = [
    page.getByRole('dialog').getByText(AUTOSAVE_SUCCESS_LONG_RE),
    page.getByText(AUTOSAVE_SUCCESS_LONG_RE),
    page.getByRole('dialog').getByText(AUTOSAVE_SUCCESS_SHORT_RE),
    page.getByText(AUTOSAVE_SUCCESS_SHORT_RE),
    page.getByRole('status').filter({ hasText: AUTOSAVE_TOAST_RE }),
  ];

  await expect.poll(async () => {
    const visible = await Promise.all(
      candidates.map((loc) => loc.isVisible().catch(() => false))
    );
    return visible.some(Boolean);
  }, { timeout: timeoutMs, intervals: [200] }).toBe(true);
}

export async function assertNoAutosave(page: Page, waitMs = 1600) {
  // Wait slightly longer than the debounce to ensure success does not appear
  await page.waitForTimeout(waitMs);
  const noneVisible = await Promise.all([
    page.getByText(AUTOSAVE_SUCCESS_LONG_RE).isVisible().catch(() => false),
    page.getByText(AUTOSAVE_SUCCESS_SHORT_RE).isVisible().catch(() => false),
    page.getByRole('status').filter({ hasText: AUTOSAVE_TOAST_RE }).isVisible().catch(() => false),
  ]);
  // Not visible anywhere
  expect(noneVisible.some(Boolean)).toBe(false);
}

export async function login(page: Page, username?: string, password?: string) {
  const u = username || process.env.AUTH_USERNAME || 'test';
  const p = password || process.env.AUTH_PASSWORD || 'test';
  await page.goto('/en/login');
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

export async function ensureTestRepo(page: Page) {
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  // Wait for success toast in either EN or DE to ensure the action completed
  await expect.poll(async () => {
    const en = await page.getByText("The 'test/test' repository is now ready.").isVisible().catch(() => false);
    const de = await page.getByText("Das 'test/test'-Repository ist jetzt bereit.").isVisible().catch(() => false);
    return en || de;
  }, { timeout: 8000, intervals: [200] }).toBe(true);
}

export async function assertNotVisibleFor(locator: Locator, waitMs = 1600) {
  await locator.page().waitForTimeout(waitMs);
  await expect(locator).toHaveCount(0);
}

export async function waitForLocale(page: Page, expected: 'en' | 'de', timeoutMs = 8000) {
  await expect.poll(async () => {
    const cookies = await page.context().cookies();
    const c = cookies.find(c => c.name === 'NEXT_LOCALE' && (c.domain === 'localhost' || c.domain.endsWith('.localhost')));
    return c?.value || '';
  }, { timeout: timeoutMs, intervals: [200] }).toBe(expected);
}

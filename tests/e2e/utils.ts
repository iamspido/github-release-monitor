import { expect, Page, Locator } from '@playwright/test';

// Matches autosave success indicators across EN/DE and short/long variants.
const AUTOSAVE_SUCCESS_LONG_RE = /All changes saved|Alle Änderungen gespeichert/;
const AUTOSAVE_SUCCESS_SHORT_RE = /^Saved$|^Gespeichert$/;
const AUTOSAVE_TOAST_RE = /Settings updated successfully\.|Einstellungen erfolgreich aktualisiert\./;

export async function waitForAutosave(page: Page, timeoutMs = 8000) {
  const statusLocator = page.getByRole('status').filter({ hasText: AUTOSAVE_SUCCESS_LONG_RE }).first();
  const candidates = [
    page.getByRole('dialog').getByText(AUTOSAVE_SUCCESS_LONG_RE),
    page.getByText(AUTOSAVE_SUCCESS_LONG_RE),
    page.getByRole('dialog').getByText(AUTOSAVE_SUCCESS_SHORT_RE),
    page.getByText(AUTOSAVE_SUCCESS_SHORT_RE),
    page.getByRole('status').filter({ hasText: AUTOSAVE_TOAST_RE }),
  ];

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  const endTime = Date.now() + timeoutMs;

  while (Date.now() < endTime) {
    if (await statusLocator.count()) {
      const text = await statusLocator.textContent();
      if (text && AUTOSAVE_SUCCESS_LONG_RE.test(text)) {
        return;
      }
    }
    const visible = await Promise.all(
      candidates.map((loc) => loc.isVisible().catch(() => false))
    );
    if (visible.some(Boolean)) {
      return;
    }
    await sleep(200);
  }

  throw new Error('Autosave indicator not visible within timeout');
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

export async function waitForTestRepoReady(page: Page, timeoutMs = 8_000) {
  await expect.poll(async () => {
    const en = await page.getByText("The 'test/test' repository is now ready.").isVisible().catch(() => false);
    const de = await page.getByText("Das 'test/test'-Repository ist jetzt bereit.").isVisible().catch(() => false);
    return en || de;
  }, { timeout: timeoutMs, intervals: [200] }).toBe(true);
}

export async function ensureTestRepo(page: Page, timeoutMs = 8_000) {
  await page.goto('/en/test');
  await page.getByRole('button', { name: 'Add/Reset Test Repo' }).click();
  await waitForTestRepoReady(page, timeoutMs);
}

export async function waitForRepoLink(page: Page, repoId = 'test/test', timeoutMs = 15_000) {
  const link = page.locator('a', { hasText: repoId });
  await expect(link.first()).toBeVisible({ timeout: timeoutMs });
  return link;
}

export async function assertNotVisibleFor(locator: Locator, waitMs = 1600) {
  await locator.page().waitForTimeout(waitMs);
  await expect(locator).toHaveCount(0);
}

export async function waitForLocale(page: Page, expected: 'en' | 'de', timeoutMs = 8000) {
  await expect.poll(async () => {
    const cookies = await page.context().cookies();
    const c = cookies.find(
      c =>
        c.name === 'NEXT_LOCALE' &&
        (c.domain === 'localhost' || c.domain.endsWith('.localhost')),
    );
    return c?.value || '';
  }, { timeout: timeoutMs, intervals: [200] }).toBe(expected);
}

// Simulate browser connectivity events that our app listens to.
// Debounce in UI is ~350ms; wait slightly longer after toggling.
export async function goOffline(page: Page, waitMs = 450) {
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(waitMs);
}

export async function goOnline(page: Page, waitMs = 450) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(waitMs);
}

async function hasSessionCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some(cookie => cookie.name === 'github-release-monitor-session');
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  if (await hasSessionCookie(page)) {
    return true;
  }
  const logoutButton = page.getByRole('button', { name: /logout|abmelden/i });
  return logoutButton.isVisible().catch(() => false);
}

export async function ensureAuthenticated(page: Page): Promise<void> {
  if (!(await isLoggedIn(page))) {
    await login(page);
  }
}

export async function login(page: Page, username?: string, password?: string, timeoutMs = 20_000) {
  const u = username || process.env.AUTH_USERNAME || 'test';
  const p = password || process.env.AUTH_PASSWORD || 'test';

  const loginUrlRegex = /\/(en|de)\/(login|anmelden)/;

  if (await isLoggedIn(page)) {
    await page.goto('/en', { waitUntil: 'domcontentloaded' });
    return;
  }

  const tryGotoLogin = async () => {
    await page.goto('/en/login', { waitUntil: 'domcontentloaded' });
    if (loginUrlRegex.test(new URL(page.url()).pathname)) {
      return;
    }
    await page.goto('/de/anmelden', { waitUntil: 'domcontentloaded' });
  };

  await tryGotoLogin();

  const currentPath = new URL(page.url()).pathname;
  if (!loginUrlRegex.test(currentPath)) {
    const homeRegex = /\/(en|de)(\/)?$/;
    if (homeRegex.test(currentPath) || (await isLoggedIn(page))) {
      return;
    }
    throw new Error(`Unable to reach login page, current path: ${currentPath}`);
  }

  const usernameField = page.locator('input[name="username"]');
  const passwordField = page.locator('input[name="password"]');

  if (await usernameField.count() === 0 || await passwordField.count() === 0) {
    if (await isLoggedIn(page)) {
      await page.goto('/en', { waitUntil: 'domcontentloaded' });
      return;
    }
    await tryGotoLogin();
  }

  await usernameField.waitFor({ state: 'visible', timeout: timeoutMs });
  await usernameField.fill(u, { timeout: timeoutMs });

  await passwordField.waitFor({ state: 'visible', timeout: timeoutMs });
  await passwordField.fill(p, { timeout: timeoutMs });

  const loginButton = page.getByRole('button', { name: /login|anmelden/i }).first();
  await loginButton.click({ timeout: timeoutMs });
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
}

import { expect, Page } from '@playwright/test';
import { ensureAuthenticated, waitForAutosave } from '../utils';

const localeOptionLabels: Record<string, string[]> = {
  en: ['English', 'Englisch'],
  de: ['German', 'Deutsch'],
};

const settingsPaths: Record<string, string> = {
  en: '/en/settings',
  de: '/de/einstellungen',
};

const rootPaths: Record<string, RegExp> = {
  en: /\/en(\/|$)/,
  de: /\/de(\/|$)/,
};

function extractLocaleFromUrl(urlString: string): string | null {
  const pathname = new URL(urlString).pathname;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const candidate = segments[0];
  return localeOptionLabels[candidate] ? candidate : null;
}

export async function openSettingsForLocale(page: Page, locale: 'en' | 'de'): Promise<void> {
  await page.goto(settingsPaths[locale]);
  const languageSelect = page.getByLabel('Language').or(page.getByLabel('Sprache'));
  await expect(languageSelect).toBeVisible();
}

async function selectLocale(page: Page, targetLocale: string): Promise<void> {
  const languageSelect = page.getByLabel('Language').or(page.getByLabel('Sprache'));
  await expect(languageSelect).toBeVisible();
  await languageSelect.click();

  const labels = localeOptionLabels[targetLocale] ?? [targetLocale];
  for (const label of labels) {
    const option = page.getByRole('option', { name: label });
    if (await option.count()) {
      await option.click();
      return;
    }
  }

  // Fallback to selecting by value attribute if available.
  await page.locator(`[data-value="${targetLocale}"]`).click();
}

export async function switchLocaleFromSettings(page: Page, targetLocale: 'en' | 'de'): Promise<void> {
  await selectLocale(page, targetLocale);
  await waitForAutosave(page);
  await expect(page).toHaveURL(new RegExp(settingsPaths[targetLocale].replace(/\//g, '\\/')));
}

export async function ensureAppLocale(page: Page, targetLocale: 'en' | 'de'): Promise<void> {
  await ensureAuthenticated(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  let currentLocale = extractLocaleFromUrl(page.url()) ?? 'en';
  if (currentLocale === targetLocale) {
    return;
  }

  await openSettingsForLocale(page, currentLocale as 'en' | 'de');
  await switchLocaleFromSettings(page, targetLocale);

  await page.goto('/');
  await expect(page).toHaveURL(rootPaths[targetLocale]);
}

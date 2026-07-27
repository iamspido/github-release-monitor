import { expect, type Page } from "@playwright/test";
import { type Locale, parseLocale } from "../../../src/i18n/config";
import { ensureAuthenticated, waitForAutosave } from "../utils";

function extractLocaleFromUrl(urlString: string): Locale | null {
  const pathname = new URL(urlString).pathname;
  const segments = pathname.split("/").filter(Boolean);
  return parseLocale(segments[0]);
}

async function expectLanguageSelect(page: Page): Promise<void> {
  await expect(page.getByTestId("language-select")).toBeVisible();
}

export async function openSettingsForLocale(
  page: Page,
  locale: Locale,
): Promise<void> {
  await page.goto(`/${locale}/settings`);
  await expectLanguageSelect(page);
}

async function selectLocale(page: Page, targetLocale: Locale): Promise<void> {
  const languageSelect = page.getByTestId("language-select");
  await expect(languageSelect).toBeVisible();
  await languageSelect.click();
  await page.getByTestId(`language-option-${targetLocale}`).click();
}

export async function switchLocaleFromSettings(
  page: Page,
  targetLocale: Locale,
): Promise<void> {
  await waitForAutosave(page, () => selectLocale(page, targetLocale));
  await expect.poll(() => extractLocaleFromUrl(page.url())).toBe(targetLocale);
}

export async function ensureAppLocale(
  page: Page,
  targetLocale: Locale,
): Promise<void> {
  await ensureAuthenticated(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => extractLocaleFromUrl(page.url())).not.toBeNull();
  const currentLocale = extractLocaleFromUrl(page.url());
  if (!currentLocale) {
    throw new Error(`Could not determine the locale from '${page.url()}'.`);
  }
  if (currentLocale === targetLocale) {
    return;
  }

  await page.goto("/settings");
  await expectLanguageSelect(page);
  await switchLocaleFromSettings(page, targetLocale);

  await page.goto("/");
  await expect.poll(() => extractLocaleFromUrl(page.url())).toBe(targetLocale);
}

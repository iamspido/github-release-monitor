import { test, expect } from '@playwright/test';
import { ensureAppLocale } from './utils/locale';

const settingsPaths: Record<'en', string> = { en: '/en/settings' } as const;
const settingsPathsLocale: Record<'en' | 'de', string> = {
  en: '/en/settings',
  de: '/de/einstellungen',
};
const homePaths: Record<'en' | 'de', string> = {
  en: '/en',
  de: '/de',
};
const timeFormatLabel = (locale: 'en' | 'de', variant: '12' | '24') => {
  if (locale === 'en') {
    return variant === '12' ? '12-hour' : '24-hour';
  }
  return variant === '12' ? '12-Stunden' : '24-Stunden';
};
const lastUpdatedLocator = (page: any, locale: 'en' | 'de') =>
  locale === 'en'
    ? page.locator('span:text-matches("Last updated:", "i")')
    : page.locator('span:text-matches("Letzte", "i")');

async function setFormatAndRead(page: any, locale: 'en' | 'de', variant: '12' | '24') {
  await page.goto(settingsPathsLocale[locale]);
  await page.getByLabel(timeFormatLabel(locale, variant)).click();
  await page.waitForTimeout(2000);
  await page.goto(homePaths[locale]);
  await expect(page).toHaveURL(new RegExp(`${locale === 'en' ? '/en' : '/de'}(\\/)?$`));
  await page.waitForTimeout(500);
  const text = await lastUpdatedLocator(page, locale).textContent();
  return text || '';
}

test('time format toggles AM/PM in EN and updates in DE', async ({ page }) => {
  await ensureAppLocale(page, 'en');

  const en12 = await setFormatAndRead(page, 'en', '12');
  expect(en12).toMatch(/AM|PM/);

  const en24 = await setFormatAndRead(page, 'en', '24');
  expect(en24).not.toMatch(/AM|PM/);
  expect(en24).toMatch(/\d{1,2}:\d{2}/);

  await ensureAppLocale(page, 'de');

  const de24 = await setFormatAndRead(page, 'de', '24');
  expect(de24).toMatch(/\d{1,2}:\d{2}/);

  const de12 = await setFormatAndRead(page, 'de', '12');
  expect(de12).not.toBe(de24);

  await ensureAppLocale(page, 'en');
});

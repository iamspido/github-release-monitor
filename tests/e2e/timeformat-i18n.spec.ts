import type { Locale } from "../../src/i18n/config";
import { expect, type Page, test } from "./fixtures/ensureLoggedIn";
import { waitForAutosave } from "./utils";
import { ensureAppLocale } from "./utils/locale";

async function setFormatAndRead(
  page: Page,
  locale: Locale,
  variant: "12" | "24",
) {
  await page.goto(`/${locale}/settings`);
  const formatOption = page.getByTestId(`time-format-${variant}h`);
  if (!(await formatOption.isChecked())) {
    await waitForAutosave(page, () => formatOption.click());
  }
  await page.goto(`/${locale}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/${locale}`);
  const lastUpdated = page.getByTestId("last-updated");
  await expect(lastUpdated).toBeVisible();
  const text = await lastUpdated.textContent();
  return text || "";
}

test("time format follows locale conventions in EN, DE, FR, and AR", async ({
  page,
}) => {
  await ensureAppLocale(page, "en");

  const en12 = await setFormatAndRead(page, "en", "12");
  expect(en12).toMatch(/AM|PM/);

  const en24 = await setFormatAndRead(page, "en", "24");
  expect(en24).not.toMatch(/AM|PM/);
  expect(en24).toMatch(/\d{1,2}:\d{2}/);

  await ensureAppLocale(page, "de");

  const de24 = await setFormatAndRead(page, "de", "24");
  expect(de24).toMatch(/\d{1,2}:\d{2}/);

  const de12 = await setFormatAndRead(page, "de", "12");
  expect(de12).not.toBe(de24);

  await ensureAppLocale(page, "fr");

  const fr24 = await setFormatAndRead(page, "fr", "24");
  expect(fr24).toMatch(/\d{1,2}:\d{2}/);

  const fr12 = await setFormatAndRead(page, "fr", "12");
  expect(fr12).not.toBe(fr24);

  await ensureAppLocale(page, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const ar12 = await setFormatAndRead(page, "ar", "12");
  expect(ar12).toMatch(/(?:^|\s)[صم](?:\s|$)/u);

  const ar24 = await setFormatAndRead(page, "ar", "24");
  expect(ar24).not.toMatch(/(?:^|\s)[صم](?:\s|$)/u);
  expect(ar24).toMatch(/[0-9٠-٩]{1,2}:[0-9٠-٩]{2}/u);
  expect(ar24).not.toBe(ar12);

  await ensureAppLocale(page, "en");
});

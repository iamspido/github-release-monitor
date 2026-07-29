import { type Locale, locales } from "../../src/i18n/config";
import { expect, type Page, test } from "./fixtures/ensureLoggedIn";
import { waitForAutosave } from "./utils";
import { ensureAppLocale } from "./utils/locale";

test.setTimeout(120_000);

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

test("time format follows locale conventions in every published locale", async ({
  page,
}) => {
  expect(
    new Set([
      "en",
      "de",
      "fr",
      "es",
      "pt-BR",
      "id",
      "hi",
      "zh-CN",
      "ja",
      "ko",
      "tr",
      "vi",
      "it",
      "pl",
      "ar",
    ]),
  ).toEqual(new Set(locales));

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

  await ensureAppLocale(page, "es");

  const es24 = await setFormatAndRead(page, "es", "24");
  expect(es24).toMatch(/\d{1,2}:\d{2}/);
  expect(es24).not.toMatch(/[ap]\.?\s*m\.?/iu);

  const es12 = await setFormatAndRead(page, "es", "12");
  expect(es12).toMatch(/[ap]\.?\s*m\.?/iu);

  await ensureAppLocale(page, "pt-BR");

  const ptBR24 = await setFormatAndRead(page, "pt-BR", "24");
  expect(ptBR24).toMatch(/\d{1,2}:\d{2}/);
  expect(ptBR24).not.toMatch(/[ap]\.?\s*m\.?/iu);

  const ptBR12 = await setFormatAndRead(page, "pt-BR", "12");
  expect(ptBR12).toMatch(/[ap]\.?\s*m\.?/iu);
  expect(ptBR12).not.toBe(ptBR24);

  await ensureAppLocale(page, "id");

  const id24 = await setFormatAndRead(page, "id", "24");
  expect(id24).toMatch(/\d{1,2}\.\d{2}/);
  expect(id24).not.toMatch(/AM|PM/iu);

  const id12 = await setFormatAndRead(page, "id", "12");
  expect(id12).toMatch(/AM|PM/iu);
  expect(id12).not.toBe(id24);

  await ensureAppLocale(page, "hi");

  const hi24 = await setFormatAndRead(page, "hi", "24");
  expect(hi24).toMatch(/\d{1,2}:\d{2}/);
  expect(hi24).not.toMatch(/AM|PM/iu);

  const hi12 = await setFormatAndRead(page, "hi", "12");
  expect(hi12).toMatch(/AM|PM/iu);
  expect(hi12).not.toBe(hi24);

  await ensureAppLocale(page, "zh-CN");

  const zhCN12 = await setFormatAndRead(page, "zh-CN", "12");
  expect(zhCN12).toMatch(/上午|下午/u);

  const zhCN24 = await setFormatAndRead(page, "zh-CN", "24");
  expect(zhCN24).not.toMatch(/上午|下午/u);
  expect(zhCN24).toMatch(/\d{1,2}:\d{2}/);
  expect(zhCN24).not.toBe(zhCN12);

  await ensureAppLocale(page, "ja");

  const ja12 = await setFormatAndRead(page, "ja", "12");
  expect(ja12).toMatch(/午前|午後/u);

  const ja24 = await setFormatAndRead(page, "ja", "24");
  expect(ja24).not.toMatch(/午前|午後/u);
  expect(ja24).toMatch(/\d{1,2}:\d{2}/);
  expect(ja24).not.toBe(ja12);

  await ensureAppLocale(page, "ko");

  const ko12 = await setFormatAndRead(page, "ko", "12");
  expect(ko12).toMatch(/오전|오후/u);

  const ko24 = await setFormatAndRead(page, "ko", "24");
  expect(ko24).not.toMatch(/오전|오후/u);
  expect(ko24).toMatch(/\d{1,2}:\d{2}/);
  expect(ko24).not.toBe(ko12);

  await ensureAppLocale(page, "tr");

  const tr12 = await setFormatAndRead(page, "tr", "12");
  expect(tr12).toMatch(/ÖÖ|ÖS/u);

  const tr24 = await setFormatAndRead(page, "tr", "24");
  expect(tr24).not.toMatch(/ÖÖ|ÖS/u);
  expect(tr24).toMatch(/\d{1,2}:\d{2}/);
  expect(tr24).not.toBe(tr12);

  await ensureAppLocale(page, "vi");

  const vi12 = await setFormatAndRead(page, "vi", "12");
  expect(vi12).toMatch(/SA|CH/u);

  const vi24 = await setFormatAndRead(page, "vi", "24");
  expect(vi24).not.toMatch(/SA|CH/u);
  expect(vi24).toMatch(/\d{1,2}:\d{2}/);
  expect(vi24).not.toBe(vi12);

  await ensureAppLocale(page, "it");

  const it12 = await setFormatAndRead(page, "it", "12");
  expect(it12).toMatch(/AM|PM/u);

  const it24 = await setFormatAndRead(page, "it", "24");
  expect(it24).not.toMatch(/AM|PM/u);
  expect(it24).toMatch(/\d{1,2}:\d{2}/);
  expect(it24).not.toBe(it12);

  await ensureAppLocale(page, "pl");

  const pl12 = await setFormatAndRead(page, "pl", "12");
  expect(pl12).toMatch(/AM|PM/u);

  const pl24 = await setFormatAndRead(page, "pl", "24");
  expect(pl24).not.toMatch(/AM|PM/u);
  expect(pl24).toMatch(/\d{1,2}:\d{2}/);
  expect(pl24).not.toBe(pl12);

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

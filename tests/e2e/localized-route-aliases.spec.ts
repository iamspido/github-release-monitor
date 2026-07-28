import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale } from "./utils/locale";

test("English route aliases redirect to the localized canonical path", async ({
  page,
}) => {
  await ensureAppLocale(page, "de");

  const response = await page.goto("/de/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/de\/einstellungen\?tab=notifications#mail$/);

  await ensureAppLocale(page, "en");
});

test("identical localized slugs do not redirect", async ({ page }) => {
  await ensureAppLocale(page, "de");

  const response = await page.goto("/de/test");

  expect(response?.status()).toBe(200);
  expect(response?.request().redirectedFrom()).toBeNull();
  await expect(page).toHaveURL(/\/de\/test$/);

  await ensureAppLocale(page, "en");
});

test("French route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "fr");

  const response = await page.goto("/fr/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/fr\/parametres\?tab=notifications#mail$/);

  const canonicalResponse = await page.goto("/fr/parametres");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Spanish route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "es");

  const response = await page.goto("/es/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/es\/configuracion\?tab=notifications#mail$/);

  const canonicalResponse = await page.goto("/es/configuracion");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/es/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/es\/prueba\?source=alias#result$/);

  await ensureAppLocale(page, "en");
});

test("Brazilian Portuguese route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "pt-BR");

  const response = await page.goto("/pt-br/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/pt-BR\/configuracoes\?tab=notifications#mail$/,
  );

  const canonicalResponse = await page.goto("/pt-BR/configuracoes");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/pt-BR/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/pt-BR\/teste\?source=alias#result$/);

  await ensureAppLocale(page, "en");
});

test("Simplified Chinese route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "zh-CN");

  const response = await page.goto("/zh-cn/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/zh-CN\/%E8%AE%BE%E7%BD%AE\?tab=notifications#mail$/i,
  );

  const canonicalResponse = await page.goto("/zh-CN/设置");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/zh-CN/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/zh-CN\/%E6%B5%8B%E8%AF%95\?source=alias#result$/i,
  );

  await ensureAppLocale(page, "en");
});

test("Arabic route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "ar");

  const response = await page.goto("/ar/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/ar\/%D8%A7%D9%84%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA\?tab=notifications#mail$/i,
  );

  const canonicalResponse = await page.goto("/ar/الإعدادات");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("locale prefixes are redirected to their canonical casing", async ({
  page,
}) => {
  await ensureAppLocale(page, "de");

  const response = await page.goto("/DE/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/de\/einstellungen\?tab=notifications#mail$/);

  await ensureAppLocale(page, "en");
});

test("document locale metadata follows the active locale", async ({ page }) => {
  await ensureAppLocale(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await ensureAppLocale(page, "de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await ensureAppLocale(page, "fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "inter",
  );

  await ensureAppLocale(page, "es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "inter",
  );

  await ensureAppLocale(page, "pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "inter",
  );

  await ensureAppLocale(page, "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-cjk",
  );

  const chineseFontState = await page.evaluate(async () => {
    await document.fonts.ready;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    return {
      fontFamily,
      supportsSimplifiedChinese:
        primaryFontFamily !== undefined &&
        document.fonts.check(`16px ${primaryFontFamily}`, "简体中文"),
    };
  });
  expect(chineseFontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]SC/i);
  expect(chineseFontState.supportsSimplifiedChinese).toBe(true);

  await ensureAppLocale(page, "ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-arabic",
  );

  const fontState = await page.evaluate(async () => {
    await document.fonts.ready;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    return {
      fontFamily,
      supportsArabic:
        primaryFontFamily !== undefined &&
        document.fonts.check(`16px ${primaryFontFamily}`, "العربية"),
    };
  });
  expect(fontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]Arabic/i);
  expect(fontState.supportsArabic).toBe(true);

  await ensureAppLocale(page, "en");
});

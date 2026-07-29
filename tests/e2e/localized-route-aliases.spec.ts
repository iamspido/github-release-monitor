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

test("Indonesian route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "id");

  const response = await page.goto("/ID/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/id\/pengaturan\?tab=notifications#mail$/);

  const canonicalResponse = await page.goto("/id/pengaturan");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/id/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/id\/uji\?source=alias#result$/);

  await ensureAppLocale(page, "en");
});

test("Hindi route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "hi");

  const response = await page.goto("/HI/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/hi\/%E0%A4%B8%E0%A5%87%E0%A4%9F%E0%A4%BF%E0%A4%82%E0%A4%97%E0%A5%8D%E0%A4%B8\?tab=notifications#mail$/i,
  );

  const canonicalResponse = await page.goto("/hi/सेटिंग्स");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/hi/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/hi\/%E0%A4%AA%E0%A4%B0%E0%A5%80%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%A3\?source=alias#result$/i,
  );

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

test("Japanese route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "ja");

  const response = await page.goto("/JA/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/ja\/%E8%A8%AD%E5%AE%9A\?tab=notifications#mail$/i,
  );

  const canonicalResponse = await page.goto("/ja/設定");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/ja/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/ja\/%E3%83%86%E3%82%B9%E3%83%88\?source=alias#result$/i,
  );

  await ensureAppLocale(page, "en");
});

test("Korean route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "ko");

  const response = await page.goto("/KO/settings?tab=notifications#mail");
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(response?.status()).toBe(200);
  expect(redirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/ko\/%EC%84%A4%EC%A0%95\?tab=notifications#mail$/i,
  );

  const canonicalResponse = await page.goto("/ko/설정");
  expect(canonicalResponse?.status()).toBe(200);
  expect(canonicalResponse?.request().redirectedFrom()).toBeNull();

  const testResponse = await page.goto("/ko/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/ko\/%ED%85%8C%EC%8A%A4%ED%8A%B8\?source=alias#result$/i,
  );

  await ensureAppLocale(page, "en");
});

test("Turkish route aliases redirect to canonical paths", async ({ page }) => {
  await ensureAppLocale(page, "tr");

  const settingsResponse = await page.goto(
    "/TR/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/tr\/ayarlar\?tab=notifications#mail$/i,
  );

  const loginResponse = await page.request.get("/tr/login?next=%2Ftr", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(loginLocation.pathname).toBe("/tr/giri%C5%9F");
  expect(loginLocation.search).toBe("?next=%2Ftr");

  const registerResponse = await page.request.get("/tr/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    new URL(registerResponse.headers().location, "http://localhost").pathname,
  ).toBe("/tr/kay%C4%B1t");

  const canonicalTestResponse = await page.goto("/tr/test");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Vietnamese route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "vi");

  const settingsResponse = await page.goto(
    "/VI/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(
    /\/vi\/cai-dat\?tab=notifications#mail$/i,
  );

  const loginResponse = await page.request.get("/vi/login?next=%2Fvi", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(loginLocation.pathname).toBe("/vi/dang-nhap");
  expect(loginLocation.search).toBe("?next=%2Fvi");

  const registerResponse = await page.request.get("/vi/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    new URL(registerResponse.headers().location, "http://localhost").pathname,
  ).toBe("/vi/dang-ky");

  const testResponse = await page.goto("/vi/test?source=alias#result");
  const testRedirectResponse = await testResponse
    ?.request()
    .redirectedFrom()
    ?.response();
  expect(testResponse?.status()).toBe(200);
  expect(testRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/vi\/kiem-tra\?source=alias#result$/);

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
  test.setTimeout(60_000);

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

  await ensureAppLocale(page, "hi");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-devanagari",
  );

  const hindiFontState = await page.evaluate(async () => {
    await document.fonts.ready;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    return {
      fontFamily,
      supportsHindi:
        primaryFontFamily !== undefined &&
        document.fonts.check(`16px ${primaryFontFamily}`, "हिन्दी"),
    };
  });
  expect(hindiFontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]Devanagari/i);
  expect(hindiFontState.supportsHindi).toBe(true);

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

  await ensureAppLocale(page, "id");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
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
    "noto-cjk-sc",
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

  await ensureAppLocale(page, "ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-cjk-jp",
  );

  const japaneseFontState = await page.evaluate(async () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    const loadedFaces =
      primaryFontFamily === undefined
        ? []
        : await document.fonts.load(`16px ${primaryFontFamily}`, "日本語");
    return {
      fontFamily,
      supportsJapanese: loadedFaces.length > 0,
    };
  });
  expect(japaneseFontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]JP/i);
  expect(japaneseFontState.supportsJapanese).toBe(true);

  await ensureAppLocale(page, "ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-cjk-kr",
  );

  const koreanFontState = await page.evaluate(async () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    const loadedFaces =
      primaryFontFamily === undefined
        ? []
        : await document.fonts.load(`16px ${primaryFontFamily}`, "한국어");
    return {
      fontFamily,
      supportsKorean: loadedFaces.length > 0,
    };
  });
  expect(koreanFontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]KR/i);
  expect(koreanFontState.supportsKorean).toBe(true);

  await ensureAppLocale(page, "tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto",
  );

  const turkishFontState = await page.evaluate(async () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    const loadedFaces =
      primaryFontFamily === undefined
        ? []
        : await document.fonts.load(
            `16px ${primaryFontFamily}`,
            "Türkçe ğşıİ",
          );
    return {
      fontFamily,
      supportsTurkish: loadedFaces.length > 0,
    };
  });
  expect(turkishFontState.fontFamily).toMatch(/Noto[_ ]Sans/i);
  expect(turkishFontState.supportsTurkish).toBe(true);

  await ensureAppLocale(page, "vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto",
  );

  const vietnameseFontState = await page.evaluate(async () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    const loadedFaces =
      primaryFontFamily === undefined
        ? []
        : await document.fonts.load(
            `16px ${primaryFontFamily}`,
            "Tiếng Việt ăâđêôơư",
          );
    return {
      fontFamily,
      supportsVietnamese: loadedFaces.length > 0,
    };
  });
  expect(vietnameseFontState.fontFamily).toMatch(/Noto[_ ]Sans/i);
  expect(vietnameseFontState.supportsVietnamese).toBe(true);

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

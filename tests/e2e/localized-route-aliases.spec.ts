import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale, switchLocaleFromSettings } from "./utils/locale";

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
  await expect(page).toHaveURL(/\/tr\/ayarlar\?tab=notifications#mail$/i);

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
  await expect(page).toHaveURL(/\/vi\/cai-dat\?tab=notifications#mail$/i);

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

test("Italian route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "it");

  const settingsResponse = await page.goto(
    "/IT/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/it\/impostazioni\?tab=notifications#mail$/i);

  const loginResponse = await page.request.get("/it/login?next=%2Fit", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(loginLocation.pathname).toBe("/it/accesso");
  expect(loginLocation.search).toBe("?next=%2Fit");

  const registerResponse = await page.request.get("/it/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    new URL(registerResponse.headers().location, "http://localhost").pathname,
  ).toBe("/it/registrazione");

  const canonicalTestResponse = await page.goto("/it/test");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Polish route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "pl");

  const settingsResponse = await page.goto(
    "/PL/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/pl\/ustawienia\?tab=notifications#mail$/i);

  const loginResponse = await page.request.get("/pl/login?next=%2Fpl", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(loginLocation.pathname).toBe("/pl/logowanie");
  expect(loginLocation.search).toBe("?next=%2Fpl");

  const registerResponse = await page.request.get("/pl/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    new URL(registerResponse.headers().location, "http://localhost").pathname,
  ).toBe("/pl/rejestracja");

  const canonicalTestResponse = await page.goto("/pl/test");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Ukrainian route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "uk");

  const settingsResponse = await page.goto(
    "/UK/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/uk/налаштування",
  );
  expect(new URL(page.url()).search).toBe("?tab=notifications");
  expect(new URL(page.url()).hash).toBe("#mail");

  const loginResponse = await page.request.get("/uk/login?next=%2Fuk", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(decodeURIComponent(loginLocation.pathname)).toBe("/uk/вхід");
  expect(loginLocation.search).toBe("?next=%2Fuk");

  const registerResponse = await page.request.get("/uk/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    decodeURIComponent(
      new URL(registerResponse.headers().location, "http://localhost").pathname,
    ),
  ).toBe("/uk/реєстрація");

  const canonicalTestResponse = await page.goto("/uk/тест");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Dutch route aliases redirect to canonical translated paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "nl");

  const settingsResponse = await page.goto(
    "/NL/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  await expect(page).toHaveURL(/\/nl\/instellingen\?tab=notifications#mail$/i);

  const loginResponse = await page.request.get("/nl/login?next=%2Fnl", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(loginLocation.pathname).toBe("/nl/inloggen");
  expect(loginLocation.search).toBe("?next=%2Fnl");

  const registerResponse = await page.request.get("/nl/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    new URL(registerResponse.headers().location, "http://localhost").pathname,
  ).toBe("/nl/registreren");

  const canonicalTestResponse = await page.goto("/nl/test");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Russian route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "ru");

  const settingsResponse = await page.goto(
    "/RU/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/ru/настройки",
  );
  expect(new URL(page.url()).search).toBe("?tab=notifications");
  expect(new URL(page.url()).hash).toBe("#mail");

  const loginResponse = await page.request.get("/ru/login?next=%2Fru", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(decodeURIComponent(loginLocation.pathname)).toBe("/ru/вход");
  expect(loginLocation.search).toBe("?next=%2Fru");

  const registerResponse = await page.request.get("/ru/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    decodeURIComponent(
      new URL(registerResponse.headers().location, "http://localhost").pathname,
    ),
  ).toBe("/ru/регистрация");

  const canonicalTestResponse = await page.goto("/ru/тест");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

  await ensureAppLocale(page, "en");
});

test("Hebrew route aliases redirect to Unicode canonical paths", async ({
  page,
}) => {
  await ensureAppLocale(page, "he");

  const settingsResponse = await page.goto(
    "/HE/settings?tab=notifications#mail",
  );
  const settingsRedirectResponse = await settingsResponse
    ?.request()
    .redirectedFrom()
    ?.response();

  expect(settingsResponse?.status()).toBe(200);
  expect(settingsRedirectResponse?.status()).toBe(308);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe("/he/הגדרות");
  expect(new URL(page.url()).search).toBe("?tab=notifications");
  expect(new URL(page.url()).hash).toBe("#mail");

  const loginResponse = await page.request.get("/he/login?next=%2Fhe", {
    maxRedirects: 0,
  });
  expect(loginResponse.status()).toBe(308);
  const loginLocation = new URL(
    loginResponse.headers().location,
    "http://localhost",
  );
  expect(decodeURIComponent(loginLocation.pathname)).toBe("/he/התחברות");
  expect(loginLocation.search).toBe("?next=%2Fhe");

  const registerResponse = await page.request.get("/he/register", {
    maxRedirects: 0,
  });
  expect(registerResponse.status()).toBe(308);
  expect(
    decodeURIComponent(
      new URL(registerResponse.headers().location, "http://localhost").pathname,
    ),
  ).toBe("/he/הרשמה");

  const canonicalTestResponse = await page.goto("/he/בדיקה");
  expect(canonicalTestResponse?.status()).toBe(200);
  expect(canonicalTestResponse?.request().redirectedFrom()).toBeNull();

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
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "inter",
  );
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toMatch(/Inter/i);

  await page.goto("/en/settings");

  await switchLocaleFromSettings(page, "hi");
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

  await switchLocaleFromSettings(page, "zh-CN");
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

  await switchLocaleFromSettings(page, "ja");
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

  await switchLocaleFromSettings(page, "ko");
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

  await switchLocaleFromSettings(page, "tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto",
  );

  const notoFontState = await page.evaluate(async () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    const samples = [
      "Türkçe ğşıİ",
      "Tiếng Việt ăâđêôơư",
      "Українська їієґ",
      "Русский ё",
    ];
    return {
      fontFamily,
      supportsSamples:
        primaryFontFamily === undefined
          ? samples.map(() => false)
          : await Promise.all(
              samples.map(async (sample) => {
                const loadedFaces = await document.fonts.load(
                  `16px ${primaryFontFamily}`,
                  sample,
                );
                return loadedFaces.length > 0;
              }),
            ),
    };
  });
  expect(notoFontState.fontFamily).toMatch(/Noto[_ ]Sans/i);
  expect(notoFontState.supportsSamples).toEqual([true, true, true, true]);

  await switchLocaleFromSettings(page, "he");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-profile",
    "noto-hebrew",
  );

  const hebrewFontState = await page.evaluate(async () => {
    await document.fonts.ready;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const primaryFontFamily = fontFamily.split(",", 1)[0]?.trim();
    return {
      fontFamily,
      supportsHebrew:
        primaryFontFamily !== undefined &&
        document.fonts.check(`16px ${primaryFontFamily}`, "עברית אבג"),
    };
  });
  expect(hebrewFontState.fontFamily).toMatch(/Noto[_ ]Sans[_ ]Hebrew/i);
  expect(hebrewFontState.supportsHebrew).toBe(true);

  await switchLocaleFromSettings(page, "ar");
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
});

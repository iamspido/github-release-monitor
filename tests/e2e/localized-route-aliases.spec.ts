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

  await ensureAppLocale(page, "en");
});

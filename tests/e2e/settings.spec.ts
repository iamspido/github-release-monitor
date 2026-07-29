import { expect, test } from "./fixtures/ensureLoggedIn";
import {
  ensureAppLocale,
  openSettingsForLocale,
  switchLocaleFromSettings,
} from "./utils/locale";

test("switch locale to German via settings", async ({ page }) => {
  await ensureAppLocale(page, "en");
  await openSettingsForLocale(page, "en");
  await switchLocaleFromSettings(page, "de");
  await page.goto("/de/test");
  await expect(
    page.getByRole("heading", { name: "Systemkonfigurationstest" }),
  ).toBeVisible();
  await ensureAppLocale(page, "en");
});

test("language dropdown keeps English first and sorts native names", async ({
  page,
}) => {
  await ensureAppLocale(page, "en");
  await openSettingsForLocale(page, "en");
  await page.getByTestId("language-select").click();

  const options = page.locator('[data-testid^="language-option-"]');
  await expect(options).toHaveCount(19);
  await expect(options).toHaveText([
    "English",
    "Bahasa Indonesia",
    "Deutsch",
    "Español",
    "Français",
    "Italiano",
    "Nederlands",
    "Polski",
    "Português (Brasil)",
    "Tiếng Việt",
    "Türkçe",
    "Русский",
    "Українська",
    "עברית",
    "العربية",
    "हिन्दी",
    "한국어",
    "日本語",
    "简体中文",
  ]);
});

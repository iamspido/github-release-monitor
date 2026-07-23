import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale } from "./utils/locale";

test("header aria-labels are localized in DE", async ({ page }) => {
  await ensureAppLocale(page, "de");
  try {
    await page.goto("/de");
    await expect(
      page.getByRole("link", { name: "Zurück zur Startseite" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Einstellungen öffnen" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Testseite öffnen" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
  } finally {
    await ensureAppLocale(page, "en");
  }
});

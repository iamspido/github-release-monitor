import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale } from "./utils/locale";

test("home headings localized when switching locale via settings", async ({
  page,
}) => {
  await ensureAppLocale(page, "de");
  await page.goto("/de");
  await expect(
    page.getByRole("heading", { name: "Überwachte Repositories" }),
  ).toBeVisible();

  await ensureAppLocale(page, "en");
  await page.goto("/en");
  await expect(
    page.getByRole("heading", { name: "Monitored Repositories" }),
  ).toBeVisible();
});

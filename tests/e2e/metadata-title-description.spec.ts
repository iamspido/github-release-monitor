import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale } from "./utils/locale";

test("title and description are localized on EN routes", async ({ page }) => {
  await ensureAppLocale(page, "en");

  for (const path of ["/en", "/en/settings", "/en/test"]) {
    await page.goto(path);
    await expect(page).toHaveTitle("GitHub Release Monitor");
    const desc = await page
      .locator('head meta[name="description"]')
      .getAttribute("content");
    expect(desc).toBe("Monitor GitHub releases with ease.");
  }
});

test("title and description are localized on DE routes", async ({ page }) => {
  await ensureAppLocale(page, "de");
  try {
    for (const path of ["/de", "/de/einstellungen", "/de/test"]) {
      await page.goto(path);
      await expect(page).toHaveTitle("GitHub Release Monitor");
      const desc = await page
        .locator('head meta[name="description"]')
        .getAttribute("content");
      expect(desc).toBe("Überwachen Sie GitHub-Releases mit Leichtigkeit.");
    }
  } finally {
    await ensureAppLocale(page, "en");
  }
});

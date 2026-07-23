import { expect, test } from "./fixtures/ensureLoggedIn";
import { goOffline, goOnline, login, waitForAutosave } from "./utils";
import { ensureAppLocale } from "./utils/locale";

const NOTICE_EN = "Offline – changes are read-only and auto-save is paused.";

test.describe("Global settings offline read-only + autosave pause", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await ensureAppLocale(page, "en");
    await page.goto("/en/settings");
  });

  test("inline notice under page title and controls disabled offline; re-enable online and autosave works", async ({
    page,
  }) => {
    // Notice under the main title
    const title = page.getByRole("heading", { name: "Application Settings" });
    await expect(title).toBeVisible();

    await goOffline(page);
    // Notice should become visible; assert the exact EN copy on /en/settings
    await expect(page.getByText(NOTICE_EN)).toBeVisible();

    // Representative controls disabled
    // Radios for time format should be disabled
    await expect(page.getByLabel("12-hour")).toBeDisabled();
    await expect(page.getByLabel("24-hour")).toBeDisabled();
    await expect(page.getByLabel("Language")).toBeDisabled();
    await expect(
      page.getByLabel(/Mark as seen|Als gesehen markieren/),
    ).toBeDisabled();
    await expect(
      page
        .getByLabel("Include Pattern")
        .or(page.getByLabel("Einschließen-Muster (Include)")),
    ).toBeDisabled();

    const intervalMinutes = page
      .getByLabel("Minutes", { exact: true })
      .or(page.getByLabel("Minuten", { exact: true }))
      .first();
    await expect(intervalMinutes).toBeDisabled();

    // Danger zone button disabled
    const deleteAll = page
      .getByRole("button", { name: "Delete All Repositories" })
      .or(page.getByRole("button", { name: "Alle Repositories löschen" }));
    await expect(deleteAll).toBeDisabled();

    // Back online → controls enabled again
    await goOnline(page);
    await expect(page.getByLabel("12-hour")).toBeEnabled();

    // Tweak a field to trigger autosave (e.g., releases-per-page)
    const rpp = page
      .getByLabel("Number of releases to fetch per repository")
      .or(page.getByLabel("Anzahl der pro Repository abzurufenden Releases"));
    const originalRpp = await rpp.inputValue();
    const changedRpp = originalRpp === "31" ? "32" : "31";
    await waitForAutosave(page, () => rpp.fill(changedRpp));

    // Restore shared E2E state and wait for a fresh success indication rather
    // than accidentally matching the one from the change above.
    await expect(
      page.getByText("All changes saved", { exact: true }),
    ).toHaveCount(0, { timeout: 5000 });
    await waitForAutosave(page, async () => {
      await rpp.fill(originalRpp);
      await rpp.blur();
    });

    await page.reload();
    await expect(rpp).toHaveValue(originalRpp);
  });
});

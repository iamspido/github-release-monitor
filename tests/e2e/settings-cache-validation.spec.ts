import { expect, test } from "./fixtures/ensureLoggedIn";
import { assertNoAutosave } from "./utils";

test("cache > refresh shows error and blocks autosave", async ({ page }) => {
  await page.goto("/en/settings");

  // Set refresh to 1 minute
  const refreshMinutes = page
    .getByLabel("Minutes", { exact: true })
    .or(page.getByLabel("Minuten", { exact: true }))
    .first();
  const refreshHours = page
    .getByLabel("Hours", { exact: true })
    .or(page.getByLabel("Stunden", { exact: true }))
    .first();
  const refreshDays = page
    .getByLabel("Days", { exact: true })
    .or(page.getByLabel("Tage", { exact: true }))
    .first();

  await refreshMinutes.fill("1");
  await refreshHours.fill("0");
  await refreshDays.fill("0");

  // Set cache to 2 minutes (greater than refresh)
  const cacheMinutes = page
    .getByLabel("Minutes", { exact: true })
    .or(page.getByLabel("Minuten", { exact: true }))
    .nth(1);
  const cacheHours = page
    .getByLabel("Hours", { exact: true })
    .or(page.getByLabel("Stunden", { exact: true }))
    .nth(1);
  const cacheDays = page
    .getByLabel("Days", { exact: true })
    .or(page.getByLabel("Tage", { exact: true }))
    .nth(1);

  await cacheMinutes.fill("2");
  await cacheHours.fill("0");
  await cacheDays.fill("0");

  await expect(
    page.getByText(
      "Cache duration cannot be longer than the refresh interval.",
    ),
  ).toBeVisible();

  // Autosave should not complete while invalid
  await assertNoAutosave(page);
});

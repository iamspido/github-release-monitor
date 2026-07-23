import { expect, test } from "./fixtures/ensureLoggedIn";
import { assertNoAutosave } from "./utils";

test("refresh interval < 1 shows error and blocks autosave", async ({
  page,
}) => {
  await page.goto("/en/settings");

  // Set refresh interval to 0 minutes (below minimum)
  const minutes = page
    .getByLabel("Minutes", { exact: true })
    .or(page.getByLabel("Minuten", { exact: true }))
    .first();
  await minutes.fill("0");

  // Inline error should be visible
  await expect(
    page.getByText("The refresh interval must be at least 1 minute."),
  ).toBeVisible();

  // Autosave should not proceed while invalid
  await assertNoAutosave(page);
});

test("releases per page > 1000 shows inline error", async ({ page }) => {
  await page.goto("/en/settings");

  const rpp = page
    .getByLabel("Number of releases to fetch per repository")
    .or(page.getByLabel("Anzahl der pro Repository abzurufenden Releases"));
  await rpp.fill("1001");

  // Inline error should be visible
  await expect(page.getByText("The number cannot exceed 1000.")).toBeVisible();

  // Autosave should not proceed while invalid
  await assertNoAutosave(page);
});

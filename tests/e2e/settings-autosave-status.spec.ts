import { expect, test } from "./fixtures/ensureLoggedIn";

test("autosave ends with All changes saved", async ({ page }) => {
  await page.goto("/en/settings");

  const rpp = page
    .getByLabel("Number of releases to fetch per repository")
    .or(page.getByLabel("Anzahl der pro Repository abzurufenden Releases"));
  // Change to a valid different value to trigger autosave
  await rpp.fill("31");

  // Wait for final success state (depending on viewport, may show "Saved" instead)
  const success = page.getByText(/All changes saved|^Saved$/);
  await expect(success).toBeVisible({ timeout: 8000 });
});

test("export button remains enabled during settings autosave", async ({
  page,
}) => {
  await page.goto("/en/settings");
  // Trigger autosave
  const rpp = page
    .getByLabel("Number of releases to fetch per repository")
    .or(page.getByLabel("Anzahl der pro Repository abzurufenden Releases"));
  await rpp.fill("32");

  // Immediately go to home and ensure Export is enabled
  await page.goto("/en");
  const exportBtn = page.getByRole("button", { name: "Export" });
  await expect(exportBtn).toBeEnabled();
});

import { expect, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, login, waitForAutosave } from "./utils";

test("repo dialog RPP sets Custom badge; Reset All removes it", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");

  // Open repo settings dialog on first card
  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();

  // Set releases-per-page for repo to make it custom
  const dialog = page.getByRole("dialog");
  const rppInput = dialog.locator('input[type="number"]').first();

  await waitForAutosave(page, () => rppInput.fill("10"));

  // Close dialog (ESC) to trigger refresh
  await page.keyboard.press("Escape");

  // Expect Custom badge on the card (exact text)
  await expect(page.getByText(/^Custom$/).first()).toBeVisible();

  // Re-open dialog and reset all settings
  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();
  await page.getByRole("button", { name: "Reset All Settings" }).click();
  await waitForAutosave(page, () =>
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Yes, reset all" })
      .click(),
  );
  await page.keyboard.press("Escape");

  // Custom badge should disappear
  await expect(page.getByText(/^Custom$/)).toHaveCount(0);
});

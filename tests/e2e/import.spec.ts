import path from "node:path";
import { expect, test } from "./fixtures/ensureLoggedIn";
import { waitForRepositoryUpdate } from "./utils";

test("import small JSON shows success and triggers refresh", async ({
  page,
}) => {
  await page.goto("/en");
  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  const jsonPath = path.resolve(import.meta.dirname, "fixtures", "repos.json");
  await fileInput.setInputFiles(jsonPath);
  // Confirm import in dialog
  // Click Import in the confirmation dialog (Radix uses role=alertdialog)
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Import" }).click();
  // Wait for import success toast (use exact text to avoid strict mode conflicts)
  await expect(
    page.getByText("Import Successful", { exact: true }),
  ).toBeVisible();
  // Wait for the background refresh result rather than the toast's default timeout.
  await waitForRepositoryUpdate(page);
  // Force a fresh render to pick up revalidated data
  await page.goto("/en");
  // Land on home and ensure the section renders
  await expect(
    page.getByRole("heading", { name: "Monitored Repositories" }),
  ).toBeVisible();
  // (We already asserted success + completion toasts; card rendering depends on GitHub API
  // and is covered by other flows via the virtual test repo.)
});

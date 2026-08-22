import path from "node:path";
import { expect, test } from "./fixtures/ensureLoggedIn";

test("import confirmation dialog closes via ESC and does not import", async ({
  page,
}) => {
  await page.goto("/en");

  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  const jsonPath = path.resolve(import.meta.dirname, "fixtures", "repos.json");
  await fileInput.setInputFiles(jsonPath);

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // No success toasts
  await expect(
    page.getByText("Import Successful", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Update Complete", { exact: true })).toHaveCount(
    0,
  );
});

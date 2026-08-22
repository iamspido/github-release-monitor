import path from "node:path";
import { expect, test } from "./fixtures/ensureLoggedIn";
import { assertNotVisibleFor } from "./utils";

test("import confirmation cancel does not import or refresh", async ({
  page,
}) => {
  await page.goto("/en");

  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  const jsonPath = path.resolve(import.meta.dirname, "fixtures", "repos.json");
  await fileInput.setInputFiles(jsonPath);

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Give the UI a moment to settle and ensure no success toasts appear
  await assertNotVisibleFor(
    page.getByText("Import Successful", { exact: true }),
    1500,
  );
  await assertNotVisibleFor(
    page.getByText("Update Complete", { exact: true }),
    1500,
  );
});

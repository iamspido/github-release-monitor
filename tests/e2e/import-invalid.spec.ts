import path from "node:path";
import { expect, test } from "./fixtures/ensureLoggedIn";

test("import invalid-format JSON shows error toast", async ({ page }) => {
  await page.goto("/en");
  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  const invalidPath = path.resolve(
    import.meta.dirname,
    "fixtures",
    "invalid-format.json",
  );
  await fileInput.setInputFiles(invalidPath);
  await expect(page.getByText("Import Failed", { exact: true })).toBeVisible();
});

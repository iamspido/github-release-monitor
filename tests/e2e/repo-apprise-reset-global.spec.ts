import { expect, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, waitForAutosave } from "./utils";
import { ensureAppLocale } from "./utils/locale";

test("repo apprise format/tags reset-to-global buttons restore global hints", async ({
  page,
}) => {
  await ensureAppLocale(page, "en");
  await ensureTestRepo(page);
  await page.goto("/en");

  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  await fileInput.setInputFiles({
    name: "repo-apprise-settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "test/test",
          url: "https://github.com/test/test",
          appriseFormat: "markdown",
          appriseTags: "foo,bar",
        },
      ]),
    ),
  });
  const importDialog = page.getByRole("alertdialog");
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole("button", { name: "Import" }).click();
  await expect(
    page.getByText("Import Successful", { exact: true }),
  ).toBeVisible();
  await page.goto("/en");

  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  const formatSelect = dialog.getByLabel("Global Apprise Format");
  const tagsInput = dialog.getByLabel("Apprise Tags");

  await expect(formatSelect).toContainText("Markdown");
  await expect(tagsInput).toHaveValue("foo,bar");
  await expect(
    page.getByText("Using individual Apprise settings."),
  ).toBeVisible();

  await waitForAutosave(page, () =>
    formatSelect.locator("..").getByRole("button", { name: "Reset" }).click(),
  );
  await waitForAutosave(page, () =>
    tagsInput.locator("..").getByRole("button", { name: "Reset" }).click(),
  );

  await expect(tagsInput).toHaveValue("");
  await expect(page.getByText("Using global Apprise settings.")).toBeVisible();
});

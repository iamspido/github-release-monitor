import { expect, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, login, waitForAutosave } from "./utils";

test("repository version tag pattern persists with highest-version selection", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");

  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  const strategy = dialog.getByLabel("Release selection");
  await strategy.click();
  await waitForAutosave(page, () =>
    page.getByRole("option", { name: "Highest version" }).click(),
  );

  const pattern =
    "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$";
  const patternInput = dialog.getByLabel("Version tag pattern (optional)");
  await expect(patternInput).toBeEnabled();
  await waitForAutosave(page, () => patternInput.fill(pattern));

  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();

  const reopenedDialog = page.getByRole("dialog");
  await expect(reopenedDialog.getByLabel("Release selection")).toContainText(
    "Highest version",
  );
  await expect(
    reopenedDialog.getByLabel("Version tag pattern (optional)"),
  ).toHaveValue(pattern);
});

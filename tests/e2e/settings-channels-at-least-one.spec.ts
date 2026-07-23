import { expect, test } from "./fixtures/ensureLoggedIn";
import { assertNoAutosave } from "./utils";

test("global release channels require at least one selected", async ({
  page,
}) => {
  await page.goto("/en/settings");

  // Trying to uncheck the only selected channel should show a toast and not save
  const stable = page.getByLabel("Stable");
  await stable.click();

  await expect(
    page.getByText("At least one release type must be selected.").first(),
  ).toBeVisible();
  await assertNoAutosave(page);
});

import { expect, test } from "./fixtures/withTestRepo";
import {
  ensureTestRepo,
  login,
  removeRepositoriesIfPresent,
  waitForAutosave,
} from "./utils";

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, ["test/test"]);
});

test("repository tags follow the pointer and persist their new order", async ({
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
  const tagInput = dialog.getByRole("combobox", {
    name: "Repository tags",
    exact: true,
  });
  const existingRemoveButtons = dialog.getByRole("button", {
    name: /^Remove tag /,
  });
  while ((await existingRemoveButtons.count()) > 0) {
    await waitForAutosave(page, () => existingRemoveButtons.first().click());
  }
  await waitForAutosave(page, async () => {
    await tagInput.fill("first");
    await tagInput.press("Enter");
  });
  await waitForAutosave(page, async () => {
    await tagInput.fill("second");
    await tagInput.press("Enter");
  });

  const tagList = dialog.locator("ul").filter({ hasText: "first" });
  const firstLabel = tagList.getByText("first", { exact: true });
  const listBounds = await tagList.boundingBox();
  const firstBounds = await firstLabel.boundingBox();
  expect(listBounds).not.toBeNull();
  expect(firstBounds).not.toBeNull();
  if (!listBounds || !firstBounds) return;

  await page.mouse.move(
    firstBounds.x + firstBounds.width / 2,
    firstBounds.y + firstBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    listBounds.x + listBounds.width - 2,
    listBounds.y + listBounds.height / 2,
    { steps: 8 },
  );

  await expect(page.locator('[data-tag-drag-preview="true"]')).toBeVisible();
  await expect(
    dialog.locator('[data-tag-drop-placeholder="true"]'),
  ).toBeVisible();
  await expect(
    dialog.locator('[data-repository-tag-dragging="true"]'),
  ).toHaveCSS("opacity", "0");

  await waitForAutosave(page, () => page.mouse.up());
  await expect(page.locator('[data-tag-drag-preview="true"]')).toHaveCount(0);
  expect(
    await tagList.locator("li[data-repository-tag-index]").allTextContents(),
  ).toEqual(["second", "first"]);
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();
  const persistedTags = page
    .getByRole("dialog")
    .locator("li[data-repository-tag-index]");
  await expect(persistedTags).toHaveCount(2);
  expect(await persistedTags.allTextContents()).toEqual(["second", "first"]);
});

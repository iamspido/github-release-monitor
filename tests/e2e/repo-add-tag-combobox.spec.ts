import { expect, test } from "./fixtures/withTestRepo";
import {
  ensureRepositoryFormExpanded,
  ensureTestRepo,
  login,
  removeRepositoriesIfPresent,
  waitForRepoLink,
  waitForRepositoryUpdate,
} from "./utils";

const CREATED_REPOSITORIES = [
  "test/test",
  "add-tag-target/repository",
  "add-tag-limit/repository",
  "add-tag-options/repository",
] as const;

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, CREATED_REPOSITORIES);
});

test("new and existing tags can be selected while adding repositories", async ({
  page,
}) => {
  await ensureTestRepo(page);
  await page.goto("/en");

  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  await fileInput.setInputFiles({
    name: "available-repository-tags.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "test/test",
          url: "https://github.com/test/test",
          tags: ["infra", "media"],
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
  await waitForRepositoryUpdate(page);

  await page.goto("/en");
  await ensureRepositoryFormExpanded(page);

  const tagInput = page.getByRole("combobox", {
    name: "Search or add repository tags",
  });
  await tagInput.focus();
  const infraOption = page.getByRole("option", { name: "infra" });
  await expect(infraOption).toBeVisible();
  await expect(infraOption.locator('[data-tag-add-icon="true"]')).toBeVisible();
  await tagInput.fill("med");
  await page.getByRole("option", { name: "media" }).click();
  await expect(
    page.getByRole("button", { name: "Remove tag media" }),
  ).toBeVisible();

  await tagInput.fill("new-tag");
  await expect(
    page.getByRole("option", { name: "Add “new-tag” as a new tag" }),
  ).toBeVisible();
  await tagInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove tag new-tag" }),
  ).toBeVisible();

  await page
    .locator('textarea[name="urls"]')
    .fill("https://github.com/add-tag-target/repository");
  const addRepositoriesButton = page.getByTestId("add-repositories");
  await expect(addRepositoriesButton).toBeEnabled();
  // The completed server action can replace the form before Playwright's
  // locator click settles, causing it to retry against the reset button.
  await addRepositoriesButton.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement) || element.disabled) {
      throw new Error("Expected an enabled repository submit button.");
    }
    element.click();
  });
  await expect(
    page.getByText("Repositories Processed", { exact: true }),
  ).toBeVisible();
  await waitForRepositoryUpdate(page);

  await page.goto("/en");
  const repoLink = await waitForRepoLink(page, "add-tag-target/repository");
  const repositoryCard = repoLink.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
  );
  await expect(
    repositoryCard.getByText("media", { exact: true }),
  ).toBeVisible();
  await expect(
    repositoryCard.getByText("new-tag", { exact: true }),
  ).toBeVisible();
});

test("shows every matching tag in a scrollable menu outside the add form border", async ({
  page,
}) => {
  await login(page);
  await page.goto("/en");

  const tags = Array.from(
    { length: 20 },
    (_, index) => `option-tag-${String(index).padStart(2, "0")}`,
  );
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "repository-with-many-tags.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "add-tag-options/repository",
          url: "https://github.com/add-tag-options/repository",
          tags,
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
  await waitForRepositoryUpdate(page);

  await page.goto("/en");
  await ensureRepositoryFormExpanded(page);

  const tagInput = page.getByRole("combobox", {
    name: "Search or add repository tags",
  });
  await tagInput.fill("option-tag-");

  const listbox = page.getByRole("listbox", { name: "Existing tags" });
  await expect(listbox).toBeVisible();
  await expect(page.getByRole("option", { name: /^option-tag-/ })).toHaveCount(
    tags.length,
  );
  await expect
    .poll(() =>
      listbox.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);

  const addFormCard = page
    .getByRole("heading", { name: "Add Repositories" })
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
    );
  const [cardBox, listboxBox] = await Promise.all([
    addFormCard.boundingBox(),
    listbox.boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(listboxBox).not.toBeNull();

  if (!cardBox || !listboxBox) {
    throw new Error("Could not determine tag menu and add form bounds.");
  }

  const cardTop = cardBox.y;
  const cardBottom = cardTop + cardBox.height;
  const listboxTop = listboxBox.y;
  const listboxBottom = listboxBox.y + listboxBox.height;
  const pointOutsideCard = (() => {
    if (listboxBottom > cardBottom) {
      const visibleOutsideTop = Math.max(cardBottom, listboxTop);
      return {
        x: listboxBox.x + listboxBox.width / 2,
        y: visibleOutsideTop + (listboxBottom - visibleOutsideTop) / 2,
      };
    }

    if (listboxTop < cardTop) {
      const visibleOutsideBottom = Math.min(cardTop, listboxBottom);
      return {
        x: listboxBox.x + listboxBox.width / 2,
        y: listboxTop + (visibleOutsideBottom - listboxTop) / 2,
      };
    }

    throw new Error("The tag menu did not extend beyond the add form bounds.");
  })();
  expect(
    await listbox.evaluate(
      (element, point) =>
        element.contains(document.elementFromPoint(point.x, point.y)),
      pointOutsideCard,
    ),
  ).toBe(true);

  const lastTag = tags.at(-1);
  if (!lastTag) throw new Error("Expected at least one tag option.");

  const lastOption = page.getByRole("option", { name: lastTag, exact: true });
  await lastOption.scrollIntoViewIfNeeded();
  await lastOption.click();
  await expect(
    page.getByRole("button", { name: `Remove tag ${lastTag}` }),
  ).toBeVisible();
});

test("keeps the import preview open when selected tags exceed the limit", async ({
  page,
}) => {
  await login(page);
  await page.goto("/en");

  const repositoryId = "add-tag-limit/repository";
  const repositoryUrl = `https://github.com/${repositoryId}`;
  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  await fileInput.setInputFiles({
    name: "repository-with-tag-limit.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: repositoryId,
          url: repositoryUrl,
          tags: Array.from({ length: 20 }, (_, index) => `limit-${index}`),
        },
      ]),
    ),
  });

  const initialImportDialog = page.getByRole("alertdialog");
  await expect(initialImportDialog).toBeVisible();
  await initialImportDialog.getByRole("button", { name: "Import" }).click();
  await expect(
    page.getByText("Import Successful", { exact: true }),
  ).toBeVisible();
  await waitForRepositoryUpdate(page);

  await page.goto("/en");
  await ensureRepositoryFormExpanded(page);
  const tagInput = page.getByRole("combobox", {
    name: "Search or add repository tags",
  });
  await tagInput.fill("overflow-tag");
  await tagInput.press("Enter");

  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "repository-tag-limit-update.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([{ id: repositoryId, url: repositoryUrl }]),
    ),
  });

  const failedImportDialog = page.getByRole("alertdialog");
  await expect(failedImportDialog).toBeVisible();
  await failedImportDialog.getByRole("button", { name: "Import" }).click();

  await expect(page.getByText("Import Failed", { exact: true })).toBeVisible();
  await expect(failedImportDialog).toBeVisible();
  await failedImportDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(failedImportDialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove tag overflow-tag" }),
  ).toBeVisible();
});

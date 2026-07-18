import { expect, test } from "@playwright/test";
import {
  ensureRepositoryFormExpanded,
  ensureTestRepo,
  login,
  removeRepositoriesIfPresent,
  waitForRepoLink,
} from "./utils";

const CREATED_REPOSITORIES = [
  "test/test",
  "add-tag-target/repository",
  "add-tag-import/repository",
  "add-tag-limit/repository",
] as const;

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, CREATED_REPOSITORIES);
});

test("new and existing tags can be selected while adding repositories", async ({
  page,
}) => {
  await login(page);
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
  await page
    .getByRole("button", { name: "Add Repositories", exact: true })
    .click();
  await expect(
    page.getByText("Repositories Processed", { exact: true }),
  ).toBeVisible();

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

  await ensureRepositoryFormExpanded(page);
  const importTagInput = page.getByRole("combobox", {
    name: "Search or add repository tags",
  });
  await importTagInput.fill("batch-tag");
  await importTagInput.press("Enter");

  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "tagged-repository-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "add-tag-import/repository",
          url: "https://github.com/add-tag-import/repository",
          tags: ["file-tag"],
        },
      ]),
    ),
  });
  const taggedImportDialog = page.getByRole("alertdialog");
  await expect(taggedImportDialog).toBeVisible();
  await taggedImportDialog.getByRole("button", { name: "Import" }).click();
  await expect(
    page.getByText("Import Successful", { exact: true }),
  ).toBeVisible();

  await page.goto("/en");
  const importedRepoLink = await waitForRepoLink(
    page,
    "add-tag-import/repository",
  );
  const importedRepositoryCard = importedRepoLink.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
  );
  await expect(
    importedRepositoryCard.getByText("file-tag", { exact: true }),
  ).toBeVisible();
  await expect(
    importedRepositoryCard.getByText("batch-tag", { exact: true }),
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
  await expect(
    page.getByRole("button", { name: "Remove tag overflow-tag" }),
  ).toBeVisible();
});

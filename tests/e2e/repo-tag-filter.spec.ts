import { expect, test } from "./fixtures/withTestRepo";
import {
  ensureTestRepo,
  login,
  removeRepositoriesIfPresent,
  waitForAutosave,
  waitForRepoLink,
} from "./utils";

const CREATED_REPOSITORIES = [
  "test/test",
  "filter-infra/repository",
  "filter-media/repository",
  "filter-both/repository",
  "filter-none/repository",
  "filter-last-tag/repository",
] as const;

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, CREATED_REPOSITORIES);
});

test("repository tags filter cards with search, OR semantics, and untagged support", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");

  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "repository-tag-filter.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "filter-infra/repository",
          url: "https://github.com/filter-infra/repository",
          tags: ["infra"],
        },
        {
          id: "filter-media/repository",
          url: "https://github.com/filter-media/repository",
          tags: ["media"],
        },
        {
          id: "filter-both/repository",
          url: "https://github.com/filter-both/repository",
          tags: ["infra", "media"],
        },
        {
          id: "filter-none/repository",
          url: "https://github.com/filter-none/repository",
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
  await waitForRepoLink(page, "filter-infra/repository");

  await page.getByRole("button", { name: "Tags", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search repository tags" });
  await search.fill("ＭＥＤＩＡ");
  await expect(
    page.getByRole("menuitemcheckbox", { name: /^media\b/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitemcheckbox", { name: /^infra\b/ }),
  ).toHaveCount(0);
  await search.press("Escape");
  await expect(search).toHaveCount(0);

  await page.getByRole("button", { name: "Tags", exact: true }).click();
  const reopenedSearch = page.getByRole("textbox", {
    name: "Search repository tags",
  });
  await reopenedSearch.fill("");
  await page.getByRole("menuitemcheckbox", { name: /^media\b/ }).click();
  await page.keyboard.press("Escape");

  await expect(
    page.locator("a", { hasText: "filter-media/repository" }),
  ).toBeVisible();
  await expect(
    page.locator("a", { hasText: "filter-both/repository" }),
  ).toBeVisible();
  await expect(
    page.locator("a", { hasText: "filter-infra/repository" }),
  ).toHaveCount(0);
  await expect(
    page.locator("a", { hasText: "filter-none/repository" }),
  ).toHaveCount(0);

  const mediaLink = page.locator("a", {
    hasText: "filter-media/repository",
  });
  const mediaCard = mediaLink.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
  );
  await mediaCard
    .getByRole("button", { name: "Open settings for this repository" })
    .click();
  const settingsDialog = page.getByRole("dialog");
  await waitForAutosave(page, () =>
    settingsDialog.getByRole("button", { name: "Remove tag media" }).click(),
  );
  await expect(settingsDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toHaveCount(0);
  await expect(mediaLink).toHaveCount(0);

  await page.getByRole("button", { name: "Tags (1)", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /^infra\b/ }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator("a", { hasText: "filter-infra/repository" }),
  ).toBeVisible();
  await expect(
    page.locator("a", { hasText: "filter-none/repository" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Tags (2)", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Without tags\b/ }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator("a", { hasText: "filter-none/repository" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Tags (3)", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clear tag filter" }).click();
  await expect(
    page.locator("a", { hasText: "filter-infra/repository" }),
  ).toBeVisible();
  await expect(
    page.locator("a", { hasText: "filter-none/repository" }),
  ).toBeVisible();
});

test("clears a tag filter after its last matching tag is removed", async ({
  page,
}) => {
  await login(page);
  await page.goto("/en");

  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "repository-last-tag-filter.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "filter-last-tag/repository",
          url: "https://github.com/filter-last-tag/repository",
          tags: ["last-tag"],
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
  const repositoryLink = await waitForRepoLink(
    page,
    "filter-last-tag/repository",
  );
  const repositoryCard = repositoryLink.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
  );

  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /^last-tag\b/ }).click();
  await page.keyboard.press("Escape");

  await repositoryCard
    .getByRole("button", { name: "Open settings for this repository" })
    .click();
  const settingsDialog = page.getByRole("dialog");
  await waitForAutosave(page, () =>
    settingsDialog.getByRole("button", { name: "Remove tag last-tag" }).click(),
  );
  await page.keyboard.press("Escape");

  await expect(settingsDialog).toHaveCount(0);
  await expect(repositoryLink).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tags", exact: true }),
  ).toBeVisible();
});

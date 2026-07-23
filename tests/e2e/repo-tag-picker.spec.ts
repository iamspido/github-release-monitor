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
  "tag-source/repository",
  "tag-picker-target/repository",
] as const;

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, CREATED_REPOSITORIES);
});

test("existing repository tags can be searched and added from a compact picker", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");

  const availableTags = [
    "infra",
    "media",
    "retro",
    ...Array.from(
      { length: 17 },
      (_, index) => `source-tag-${String(index).padStart(2, "0")}`,
    ),
  ];

  const fileInput = page.locator('input[type="file"][accept*=".json"]');
  await fileInput.setInputFiles({
    name: "repository-tags.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "tag-source/repository",
          url: "https://github.com/tag-source/repository",
          tags: availableTags,
        },
        {
          id: "tag-picker-target/repository",
          url: "https://github.com/tag-picker-target/repository",
          tags: [],
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
  const targetLink = await waitForRepoLink(
    page,
    "tag-picker-target/repository",
  );
  const targetCard = targetLink.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
  );
  await targetCard
    .getByRole("button", { name: "Open settings for this repository" })
    .click();

  let dialog = page.getByRole("dialog");
  let search = dialog.getByRole("combobox", {
    name: "Repository tags",
  });
  await search.focus();
  await expect(search).toBeFocused();

  const tagListbox = page.getByRole("listbox", { name: "Existing tags" });
  await expect(tagListbox).toBeVisible();
  await expect
    .poll(() =>
      tagListbox.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await tagListbox.hover();
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => tagListbox.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  await search.fill("med");
  const mediaOption = page.getByRole("option", { name: "media" });
  await expect(mediaOption).toBeVisible();
  await expect(mediaOption).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("option", { name: "retro" })).toHaveCount(0);

  await dialog.getByText("Organization", { exact: true }).click();
  await expect(search).toHaveValue("med");
  await expect(dialog.getByText("med", { exact: true })).toHaveCount(0);
  await search.focus();

  await waitForAutosave(page, () =>
    page.getByRole("option", { name: "media" }).click(),
  );
  await expect(dialog).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toHaveValue("");
  await expect(dialog.getByText("media", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "media" })).toHaveCount(0);
  await search.fill("media");
  await expect(
    page.getByRole("option", { name: "Add “media” as a new tag" }),
  ).toHaveCount(0);
  await search.press("Escape");
  await expect(dialog).toHaveCount(0);

  await targetCard
    .getByRole("button", { name: "Open settings for this repository" })
    .click();
  dialog = page.getByRole("dialog");
  search = dialog.getByRole("combobox", { name: "Repository tags" });

  await search.fill("settings-new-tag");
  await expect(
    page.getByRole("option", {
      name: "Add “settings-new-tag” as a new tag",
    }),
  ).toBeVisible();
  await waitForAutosave(page, () => search.press("Enter"));
  await expect(
    dialog.getByText("settings-new-tag", { exact: true }),
  ).toBeVisible();
  await expect(search).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const reloadedTargetLink = await waitForRepoLink(
    page,
    "tag-picker-target/repository",
  );
  await reloadedTargetLink
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
    )
    .getByRole("button", { name: "Open settings for this repository" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("media", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("settings-new-tag", { exact: true }),
  ).toBeVisible();
});

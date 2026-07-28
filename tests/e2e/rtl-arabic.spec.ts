import { expect, test } from "./fixtures/withTestRepo";
import {
  ensureTestRepo,
  removeRepositoriesIfPresent,
  waitForAutosave,
  waitForRepoLink,
} from "./utils";
import { ensureAppLocale } from "./utils/locale";

test.afterEach(async ({ page }) => {
  await removeRepositoriesIfPresent(page, ["test/test"]);
  await ensureAppLocale(page, "en");
});

test("Arabic desktop and mobile surfaces preserve RTL and isolate technical text", async ({
  page,
}) => {
  await ensureAppLocale(page, "ar");
  await ensureTestRepo(page);
  await page.goto("/ar");
  await waitForRepoLink(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("data-font-profile", "noto-arabic");
  await expect(
    page.locator('bdi[dir="ltr"]', { hasText: "test/test" }),
  ).toBeVisible();

  const markdown = page.locator(".prose").first();
  await expect(markdown).toHaveAttribute("dir", "auto");
  await expect(markdown.locator("pre")).toHaveCSS("direction", "ltr");
  await expect(markdown.locator("code").first()).toHaveCSS("direction", "ltr");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page
    .getByRole("button", { name: "افتح الإعدادات لهذا المستودع" })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("direction", "rtl");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 420, height: 900 });
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("direction", "rtl");
  await menu.getByRole("menuitem", { name: "إعدادات" }).click();
  await expect(page).toHaveURL(
    /\/ar\/%D8%A7%D9%84%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA$/i,
  );

  const languageSelect = page.getByTestId("language-select");
  await languageSelect.focus();
  await page.keyboard.press("Enter");
  const languageListbox = page.getByRole("listbox");
  await expect(languageListbox).toBeVisible();
  await expect(languageListbox).toHaveCSS("direction", "rtl");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("language-option-en")).toHaveAttribute(
    "data-highlighted",
    "",
  );
  await page.keyboard.press("End");
  await expect(
    languageListbox.locator('[data-testid^="language-option-"]').last(),
  ).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Escape");
  await expect(languageSelect).toBeFocused();

  await page.getByRole("checkbox", { name: "مستقر" }).click();
  const toastDescription = page.getByText(
    "يجب تحديد نوع إصدار واحد على الأقل.",
    { exact: true },
  );
  await expect(toastDescription).toBeVisible();
  const toast = toastDescription.locator(
    "xpath=ancestor::*[@data-state='open'][1]",
  );
  await expect(toast).toHaveCSS("direction", "rtl");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("Arabic tag dragging follows the visible RTL movement direction", async ({
  page,
}) => {
  await ensureAppLocale(page, "ar");
  await ensureTestRepo(page);
  await page.goto("/ar");
  await waitForRepoLink(page);

  await page
    .getByRole("button", { name: "افتح الإعدادات لهذا المستودع" })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  const tagInput = dialog.getByRole("combobox", {
    name: "علامات المستودع",
    exact: true,
  });
  const existingRemoveButtons = dialog.getByRole("button", {
    name: /^إزالة العلامة /,
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
    listBounds.x + 2,
    listBounds.y + listBounds.height / 2,
    { steps: 8 },
  );
  await expect(page.locator('[data-tag-drag-preview="true"]')).toBeVisible();
  await waitForAutosave(page, () => page.mouse.up());

  expect(
    await tagList.locator("li[data-repository-tag-index]").allTextContents(),
  ).toEqual(["second", "first"]);
});

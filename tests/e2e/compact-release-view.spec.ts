import { expect, test } from "./fixtures/withTestRepo";
import {
  ensureTestRepo,
  login,
  waitForAutosave,
  waitForRepoLink,
} from "./utils";

test("compact rows expand from free space and persist before server render", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");
  await waitForRepoLink(page);

  await page
    .getByRole("button", { name: "Open settings for this repository" })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await waitForAutosave(page, () =>
    dialog.getByLabel("Display name (optional)").fill("Compact status"),
  );
  const pinCheckbox = dialog.getByRole("checkbox", { name: "Pin to top" });
  if (!(await pinCheckbox.isChecked())) {
    await waitForAutosave(page, () => pinCheckbox.click());
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const compactButton = page.getByRole("button", { name: "Compact" });
  await compactButton.click();
  await expect(compactButton).toHaveAttribute("aria-pressed", "true");

  const row = page.locator("article").filter({ hasText: "test/test" }).first();
  const rowBox = await row.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox?.width ?? 0).toBeGreaterThan(500);
  await expect(row.getByLabel("Pinned to top").first()).toBeVisible();
  await expect(
    row.getByLabel("This repository is using custom settings.").first(),
  ).toBeVisible();
  const expandButton = row.getByRole("button", {
    name: /Expand release details for .*test\/test/,
  });
  await expect(expandButton).toHaveAttribute("aria-expanded", "false");
  await expect(
    row.getByRole("button", {
      name: /Mark release for .*test\/test as (?:new|seen)/,
    }),
  ).toBeVisible();
  const settingsButton = row.getByRole("button", {
    name: /Open settings for .*test\/test/,
  });
  await expect(settingsButton).toBeVisible();
  await expect(
    row.getByRole("link", { name: /Open release for .*test\/test/ }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: /Remove .*test\/test/ }),
  ).toBeVisible();

  // Keep enough content below the row for it to scroll fully underneath the
  // sticky header. This verifies the real browser stacking order, not just the
  // classes used to create it.
  await expandButton.click();
  const collapseButton = row.getByRole("button", {
    name: /Collapse release details for .*test\/test/,
  });
  await expect(collapseButton).toHaveAttribute("aria-expanded", "true");
  await page.setViewportSize({ width: 1280, height: 320 });
  await row.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const settingsButtonBox = await settingsButton.boundingBox();
  expect(settingsButtonBox).not.toBeNull();
  const headerIsTopmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("header") !== null,
    {
      x: (settingsButtonBox?.x ?? 0) + (settingsButtonBox?.width ?? 0) / 2,
      y: (settingsButtonBox?.y ?? 0) + (settingsButtonBox?.height ?? 0) / 2,
    },
  );
  expect(headerIsTopmost).toBe(true);
  await page.evaluate(() => window.scrollBy(0, -96));
  await collapseButton.click();
  await expect(
    row.getByRole("button", {
      name: /Expand release details for .*test\/test/,
    }),
  ).toHaveAttribute("aria-expanded", "false");

  const repositoryLink = row.getByRole("link", {
    name: /^(?:github:)?test\/test$/,
  });
  const identityArea = repositoryLink.locator("..");
  const identityBox = await identityArea.boundingBox();
  const repositoryLinkBox = await repositoryLink.boundingBox();
  expect(identityBox).not.toBeNull();
  expect(repositoryLinkBox).not.toBeNull();

  const urlBefore = page.url();
  await page.mouse.click(
    (identityBox?.x ?? 0) + (identityBox?.width ?? 0) - 4,
    (repositoryLinkBox?.y ?? 0) + (repositoryLinkBox?.height ?? 0) / 2,
  );

  await expect(
    row.getByRole("button", {
      name: /Collapse release details for .*test\/test/,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(urlBefore);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.getByLabel("Pinned to top").first()).toBeHidden();
  await expect(row.getByLabel("Pinned to top").last()).toBeVisible();
  await expect(
    row.getByLabel("This repository is using custom settings.").first(),
  ).toBeHidden();
  await expect(
    row.getByLabel("This repository is using custom settings.").last(),
  ).toBeVisible();

  const viewModeCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "grm_release_view_mode",
  );
  expect(viewModeCookie?.value).toBe("compact");

  const response = await page.reload({ waitUntil: "domcontentloaded" });
  const serverHtml = (await response?.text()) ?? "";
  expect(serverHtml).toMatch(/Expand release details for [^"]*test\/test/);
  expect(serverHtml).not.toContain('class="prose ');
});

import { expect, type Page, type Request, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, login, waitForRepoLink } from "./utils";

function trackPostRequestsUntilSettled(page: Page) {
  let started = 0;
  const pending = new Set<Request>();
  const onRequest = (request: Request) => {
    if (request.method() !== "POST") return;
    started += 1;
    pending.add(request);
  };
  const onRequestDone = (request: Request) => {
    pending.delete(request);
  };

  page.on("request", onRequest);
  page.on("requestfinished", onRequestDone);
  page.on("requestfailed", onRequestDone);

  return async () => {
    try {
      await expect
        .poll(
          async () => {
            const observedStarted = started;
            if (observedStarted === 0 || pending.size > 0) return false;
            await page.waitForTimeout(100);
            return pending.size === 0 && started === observedStarted;
          },
          { timeout: 8000 },
        )
        .toBe(true);
    } finally {
      page.off("request", onRequest);
      page.off("requestfinished", onRequestDone);
      page.off("requestfailed", onRequestDone);
    }
  };
}

test("repo dialog saves valid pending changes on Escape and blocks invalid close", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");
  await waitForRepoLink(page);

  const settingsButton = page
    .getByRole("button", { name: "Open settings for this repository" })
    .first();
  await settingsButton.click();

  let dialog = page.getByRole("dialog");
  let rppInput = dialog.locator('input[type="number"]').first();
  let includeInput = dialog
    .getByLabel("Include Pattern")
    .or(dialog.getByLabel("Einschließen-Muster (Include)"));
  const beforeRpp = await rppInput.inputValue();
  const beforeInclude = await includeInput.inputValue();
  const changedRpp = beforeRpp === "77" ? "78" : "77";
  const changedInclude = beforeInclude === "^v$" ? "^release$" : "^v$";

  const waitForSave = trackPostRequestsUntilSettled(page);
  await rppInput.fill(changedRpp);
  await includeInput.fill(changedInclude);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await waitForSave();

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  rppInput = dialog.locator('input[type="number"]').first();
  includeInput = dialog
    .getByLabel("Include Pattern")
    .or(dialog.getByLabel("Einschließen-Muster (Include)"));
  await expect(rppInput).toHaveValue(changedRpp);
  await expect(includeInput).toHaveValue(changedInclude);

  await includeInput.fill("(");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Fix the invalid settings before closing this dialog."),
  ).toBeVisible();
  await expect(includeInput).toBeFocused();

  const waitForRestore = trackPostRequestsUntilSettled(page);
  await rppInput.fill(beforeRpp);
  await includeInput.fill(beforeInclude);
  await page.keyboard.press("Escape");
  await waitForRestore();

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  rppInput = dialog.locator('input[type="number"]').first();
  includeInput = dialog
    .getByLabel("Include Pattern")
    .or(dialog.getByLabel("Einschließen-Muster (Include)"));
  await expect(rppInput).toHaveValue(beforeRpp);
  await expect(includeInput).toHaveValue(beforeInclude);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("repo dialog commits tag drafts on outside click and blocks invalid tag close", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");
  await waitForRepoLink(page);

  const settingsButton = page
    .getByRole("button", { name: "Open settings for this repository" })
    .first();
  await settingsButton.click();
  let dialog = page.getByRole("dialog");
  let tagInput = dialog.getByLabel("Repository tags");
  const tag = `close-save-${Date.now().toString(36)}`;

  const waitForSave = trackPostRequestsUntilSettled(page);
  await tagInput.fill(tag);
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await waitForSave();

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  tagInput = dialog.getByLabel("Repository tags");
  await expect(dialog.getByText(tag, { exact: true })).toBeVisible();

  const waitForRemoval = trackPostRequestsUntilSettled(page);
  await dialog.getByRole("button", { name: `Remove tag ${tag}` }).click();
  await waitForRemoval();

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  tagInput = dialog.getByLabel("Repository tags");
  await expect(dialog.getByText(tag, { exact: true })).toHaveCount(0);

  await tagInput.fill("x".repeat(41));
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Fix the invalid settings before closing this dialog."),
  ).toBeVisible();
  await expect(tagInput).toBeFocused();

  await tagInput.fill("");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("clearing a custom display name persists across reload", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");
  await waitForRepoLink(page);

  const settingsButton = page
    .getByRole("button", { name: "Open settings for this repository" })
    .first();
  await settingsButton.click();

  let dialog = page.getByRole("dialog");
  let displayNameInput = dialog.getByLabel(/Display [Nn]ame \(optional\)/);
  const originalDisplayName = await displayNameInput.inputValue();
  const customDisplayName = `Critical Monitor ${Date.now().toString(36)}`;

  const waitForCustomNameSave = trackPostRequestsUntilSettled(page);
  await displayNameInput.fill(customDisplayName);
  await displayNameInput.blur();
  await waitForCustomNameSave();
  await page.keyboard.press("Escape");

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  displayNameInput = dialog.getByLabel(/Display [Nn]ame \(optional\)/);
  await expect(displayNameInput).toHaveValue(customDisplayName);

  const waitForClear = trackPostRequestsUntilSettled(page);
  await displayNameInput.fill("");
  await displayNameInput.blur();
  await waitForClear();
  await page.keyboard.press("Escape");

  await page.reload();
  await waitForRepoLink(page);
  await settingsButton.click();
  dialog = page.getByRole("dialog");
  displayNameInput = dialog.getByLabel(/Display [Nn]ame \(optional\)/);
  await expect(displayNameInput).toHaveValue("");

  if (originalDisplayName) {
    const waitForRestore = trackPostRequestsUntilSettled(page);
    await displayNameInput.fill(originalDisplayName);
    await displayNameInput.blur();
    await waitForRestore();
  }
  await page.keyboard.press("Escape");
});

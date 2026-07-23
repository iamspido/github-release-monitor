import { expect, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, login } from "./utils";

test("ESC closes nested Select first, then dialog; focus returns to trigger", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");

  const trigger = page
    .getByRole("button", {
      name: /Open settings for this repository|Einstellungen für dieses Repository öffnen/,
    })
    .first();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Open a nested Select that does not depend on optional notification config.
  await page
    .getByLabel(/Background check mode|Modus für Hintergrundprüfungen/)
    .click();
  // Press ESC should close the Select, dialog remains open
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();

  // ESC again closes the dialog
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Focus returns to trigger
  await expect
    .poll(
      async () => {
        return await trigger.evaluate((el) => document.activeElement === el);
      },
      { timeout: 3000, intervals: [100] },
    )
    .toBe(true);
});

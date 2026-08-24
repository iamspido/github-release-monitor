import { expect, test } from "./fixtures/ensureLoggedIn";
import { assertNoAutosave, waitForAutosave } from "./utils";

test("notification delivery modes and limits persist", async ({ page }) => {
  await page.goto("/en/settings");

  const emailMode = page.getByLabel("Email delivery mode");
  await emailMode.click();
  await waitForAutosave(page, () =>
    page.getByRole("option", { name: "Batched", exact: true }).click(),
  );

  const appriseMode = page.getByLabel("Apprise delivery mode");
  await appriseMode.click();
  await waitForAutosave(page, () =>
    page.getByRole("option", { name: "Batched", exact: true }).click(),
  );

  const maxMessages = page.getByLabel("Maximum messages per queue run");
  const concurrency = page.getByLabel("Concurrent notification requests");
  await waitForAutosave(page, () => maxMessages.fill("0"));
  await waitForAutosave(page, () => concurrency.fill("7"));

  await page.reload();

  await expect(page.getByLabel("Email delivery mode")).toContainText("Batched");
  await expect(page.getByLabel("Apprise delivery mode")).toContainText(
    "Batched",
  );
  await expect(page.getByLabel("Maximum messages per queue run")).toHaveValue(
    "0",
  );
  await expect(page.getByLabel("Concurrent notification requests")).toHaveValue(
    "7",
  );
});

test("fractional notification delivery limits are rejected", async ({
  page,
}) => {
  await page.goto("/en/settings");

  await page.getByLabel("Maximum messages per queue run").fill("1.5");
  await page.getByLabel("Concurrent notification requests").fill("2.5");

  await expect(page.getByText("Enter a whole number.")).toHaveCount(2);
  await assertNoAutosave(page);
});

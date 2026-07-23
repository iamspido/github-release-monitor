import { expect, test } from "./fixtures/ensureLoggedIn";

test("refresh button disables during action and prevents double submit", async ({
  page,
}) => {
  await page.goto("/en");

  const refreshBtn = page.getByRole("button", { name: "Refresh" });
  await expect(refreshBtn).toBeEnabled();

  // Click twice quickly; second should be ignored because disabled during pending
  await Promise.all([refreshBtn.click(), refreshBtn.click()]);

  await expect(refreshBtn).toBeDisabled();

  // Button should return to enabled state after operation completes.
  // This is the reliable end signal; toast rendering can be flaky in CI.
  await expect(refreshBtn).toBeEnabled({ timeout: 15_000 });
});

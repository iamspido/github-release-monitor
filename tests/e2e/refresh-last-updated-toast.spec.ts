import { expect, test } from "./fixtures/ensureLoggedIn";

function getLastUpdatedText(page) {
  return page.locator("text=Last updated:");
}

test("Refresh updates last-updated and shows stable toast", async ({
  page,
}) => {
  await page.goto("/en");
  const before = await getLastUpdatedText(page).first().textContent();

  // Let a complete second elapse. This remains valid when BASE_URL points to a
  // server whose clock has a different sub-second offset from the test runner.
  const refreshNotBefore = Date.now() + 1_050;
  await expect
    .poll(() => Date.now(), {
      timeout: 1_500,
      intervals: [50],
    })
    .toBeGreaterThanOrEqual(refreshNotBefore);
  await page.getByRole("button", { name: "Refresh" }).click();
  // Expect toast (role=status) visible with matching text
  const toast = page
    .getByRole("status")
    .filter({ hasText: /Refreshed|Successfully refreshed\./i });
  await expect(toast.first()).toBeVisible();

  // Poll until Last updated text changes
  await expect
    .poll(
      async () => {
        return await getLastUpdatedText(page).first().textContent();
      },
      { timeout: 5000, intervals: [200] },
    )
    .not.toBe(before);
});

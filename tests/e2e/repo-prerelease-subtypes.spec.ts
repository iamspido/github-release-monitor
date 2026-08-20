import { expect, test } from "./fixtures/withTestRepo";
import { ensureTestRepo, login, waitForRepoLink } from "./utils";

test("pre-release subtypes toggle while keeping parent active", async ({
  page,
}) => {
  await login(page);
  await ensureTestRepo(page);
  await page.goto("/en");
  await waitForRepoLink(page);

  const settingsButton = page
    .getByRole("button", { name: "Open settings for this repository" })
    .first();
  await expect(settingsButton).toBeVisible({ timeout: 10_000 });
  await settingsButton.click();

  const pre = page.getByLabel("Pre-release", { exact: true });
  if (await pre.isChecked()) {
    await pre.uncheck();
  }
  const useGlobalMarkers = page.getByLabel(
    "Use global custom pre-release markers",
  );
  const customMarkers = page.getByRole("textbox", {
    name: "Custom pre-release markers",
    exact: true,
  });

  // Marker classification must remain configurable for stable-only filtering.
  await expect(useGlobalMarkers).toBeVisible();
  await expect(customMarkers).toBeVisible();

  // Enable Pre-release
  await pre.check();
  // Subtypes should be visible
  await expect(
    page.getByText("Select the specific pre-release types to monitor."),
  ).toBeVisible();

  // Toggle off all subtype checkboxes (visible in the section)
  const subtypeCheckboxes = page.locator(
    '[id^="prerelease-repo-"][role="checkbox"]',
  );
  const count = await subtypeCheckboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = subtypeCheckboxes.nth(i);
    if (await cb.isChecked()) await cb.click();
  }

  // Parent pre-release checkbox should remain active
  await expect(pre).toBeChecked();

  await useGlobalMarkers.uncheck();
  await customMarkers.fill("test2");
  await expect(page.getByText(/Invalid marker.*test2/)).toBeVisible();

  await pre.uncheck();
  await expect(customMarkers).toBeVisible();
  await expect(customMarkers).toBeEnabled();
  await expect(customMarkers).toHaveAttribute("dir", "auto");

  await customMarkers.clear();
  await expect(customMarkers).toBeVisible();
  await expect(useGlobalMarkers).toBeVisible();
  await expect(useGlobalMarkers).toBeEnabled();
});

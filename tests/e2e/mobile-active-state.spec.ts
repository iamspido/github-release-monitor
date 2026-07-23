import { expect, test } from "./fixtures/ensureLoggedIn";

test("mobile menu navigates correctly between routes", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });

  // Home → Settings → Test Page
  await page.goto("/en");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/en\/settings$/);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Test Page" }).click();
  await expect(page).toHaveURL(/\/en\/test$/);
});

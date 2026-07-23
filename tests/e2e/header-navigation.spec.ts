import { expect, test } from "./fixtures/ensureLoggedIn";
import { login } from "./utils";

test("header navigation: Home, Settings, Test routes work", async ({
  page,
}) => {
  await login(page);

  // Ensure we start on Home
  await page.goto("/en");

  // Navigate to Settings via the semantic header link.
  await page.getByRole("link", { name: "Open settings page" }).click();
  await expect(page).toHaveURL(/\/(en|de)\/settings$/);

  // Navigate back to Home
  await page.getByRole("link", { name: "Back to home page" }).click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Navigate to Test page
  await page.getByRole("link", { name: "Open test page" }).click();
  await expect(page).toHaveURL(/\/(en|de)\/test$/);
  await expect(
    page.getByRole("heading", { name: "System Configuration Test" }),
  ).toBeVisible();
});

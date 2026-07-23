import { expect, test } from "./fixtures/ensureLoggedIn";
import { login } from "./utils";

test("header active state follows route", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  const homeLink = page.getByRole("link", { name: "Back to home page" });
  const settingsLink = page.getByRole("link", { name: "Open settings page" });
  const testLink = page.getByRole("link", { name: "Open test page" });

  // Active state background: navigate to each route and check active link class
  await page.goto("/en");
  await expect(homeLink).toHaveClass(/bg-secondary/);

  await page.goto("/en/settings");
  await expect(settingsLink).toHaveClass(/bg-secondary/);

  await page.goto("/en/test");
  await expect(testLink).toHaveClass(/bg-secondary/);
});

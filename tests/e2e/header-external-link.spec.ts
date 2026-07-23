import { expect, test } from "./fixtures/ensureLoggedIn";
import { login } from "./utils";

test("header GitHub link has target and rel", async ({ page }) => {
  await login(page);
  await page.goto("/en");

  const link = page.getByRole("link", {
    name: /View source on GitHub|Quellcode auf GitHub ansehen/,
  });
  await expect(link).toHaveAttribute("target", "_blank");
  const rel = await link.getAttribute("rel");
  expect(rel?.includes("noopener")).toBeTruthy();
  expect(rel?.includes("noreferrer")).toBeTruthy();
});

import { expect, test } from "./fixtures/test";

test("logout in one tab protects the other tab", async ({ context, page }) => {
  const u =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || "test@example.test";
  const p = process.env.AUTH_PASSWORD || "TestPassword123";

  await page.goto("/en/login");
  await page.getByLabel(/email|e-mail/i).fill(u);
  await page.locator('input[name="password"]').fill(p);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);

  // Open second tab (inherits session in same context)
  const page2 = await context.newPage();
  await page2.goto("/en");
  await expect(
    page2.getByRole("heading", { name: "GitHub Release Monitor" }),
  ).toBeVisible();

  // Logout from tab 1
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);

  // Any navigation in tab 2 should redirect to login
  await page2.goto("/en");
  await expect(page2).toHaveURL(/\/en\/login(\?.*)?$/);
});

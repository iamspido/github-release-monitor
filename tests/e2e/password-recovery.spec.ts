import { expect, test } from "./fixtures/test";

test("login exposes CLI recovery when SMTP is not configured", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/en/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();

  await expect(
    page.getByRole("heading", { name: "Forgot your password?" }),
  ).toBeVisible();
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.locator("code")).toContainText(
    "node /app/grm-cli.mjs auth reset-password --user",
  );
});

test("invalid reset links are handled without exposing a password form", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/en/reset-password?error=INVALID_TOKEN");

  await expect(
    page.getByText(
      "This reset link is invalid, expired, or has already been used.",
    ),
  ).toBeVisible();
  await expect(page.locator("#reset-password-form")).toHaveCount(0);
});

test("direct reset API requests cannot bypass the password policy", async ({
  request,
}) => {
  const response = await request.post("/api/auth/reset-password", {
    data: { token: "invalid-token", newPassword: "weak" },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "invalid_password_policy",
  });
});

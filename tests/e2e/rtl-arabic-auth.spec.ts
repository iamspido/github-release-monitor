import { expect, test } from "./fixtures/ensureLoggedIn";
import { ensureAppLocale } from "./utils/locale";

test("Arabic login form preserves RTL layout and LTR credentials", async ({
  page,
}) => {
  await ensureAppLocale(page, "ar");
  await page.getByTestId("logout-button").click();

  await expect(page).toHaveURL(
    /\/ar\/%D8%AA%D8%B3%D8%AC%D9%8A%D9%84-%D8%A7%D9%84%D8%AF%D8%AE%D9%88%D9%84$/i,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", {
      name: "تسجيل الدخول إلى مراقب إصدارات GitHub",
    }),
  ).toBeVisible();

  const identifier = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  const passwordToggle = page.getByRole("button", {
    name: "إظهار كلمة المرور",
  });
  await expect(identifier).toHaveAttribute("dir", "ltr");
  await expect(password).toHaveAttribute("dir", "ltr");
  await expect(passwordToggle).toBeVisible();

  const passwordBounds = await password.boundingBox();
  const toggleBounds = await passwordToggle.boundingBox();
  expect(passwordBounds).not.toBeNull();
  expect(toggleBounds).not.toBeNull();
  if (passwordBounds && toggleBounds) {
    expect(toggleBounds.x).toBeGreaterThan(
      passwordBounds.x + passwordBounds.width / 2,
    );
    expect(toggleBounds.x + toggleBounds.width).toBeLessThanOrEqual(
      passwordBounds.x + passwordBounds.width,
    );
  }

  await identifier.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
});

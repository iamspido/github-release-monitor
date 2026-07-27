import { expect, test } from "./fixtures/test";
import { login } from "./utils";
import { ensureAppLocale } from "./utils/locale";

test("can login with valid credentials", async ({ page }) => {
  const username =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || "test@example.test";
  const password = process.env.AUTH_PASSWORD || "TestPassword123";

  await page.goto("/en/login");
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();

  await expect(page).toHaveURL(/\/(en|de)(\/)?$/);
  await expect(
    page.getByRole("heading", { name: "GitHub Release Monitor" }),
  ).toBeVisible();
});

test("test page renders after login", async ({ page, context }) => {
  const username =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || "test@example.test";
  const password = process.env.AUTH_PASSWORD || "TestPassword123";

  await context.addCookies([
    { name: "grm.locale", value: "en", domain: "localhost", path: "/" },
    { name: "NEXT_LOCALE", value: "en", domain: "localhost", path: "/" },
  ]);
  await page.goto("/en/login?next=/en/test");
  await page.getByLabel(/email|e-mail/i).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();

  await expect(page).toHaveURL(/\/en\/test$/);
  await expect(
    page.getByRole("heading", { name: "System Configuration Test" }),
  ).toBeVisible();
});

test("localized login with next does not trigger global error boundary", async ({
  page,
}) => {
  const username =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || "test@example.test";
  const password = process.env.AUTH_PASSWORD || "TestPassword123";
  const authErrors: string[] = [];

  await login(page, username, password);
  await ensureAppLocale(page, "de");
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL(/\/de\/anmelden$/);

  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      (text.includes("unexpected response") ||
        text.includes("Global error boundary caught"))
    ) {
      authErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (error.message.includes("unexpected response")) {
      authErrors.push(error.message);
    }
  });

  await page.goto("/de/anmelden?next=%2Fde");
  await page.locator('input[name="email"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();

  await expect(page).toHaveURL(/\/de\/?$/);
  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toContain("Something went wrong");
  expect(pageText).toContain("Überwachte Repositories");
  await ensureAppLocale(page, "en");
  expect(authErrors).toEqual([]);
});

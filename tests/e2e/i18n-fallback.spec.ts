import { expect, test } from "./fixtures/test";

test("invalid locale path uses the configured locale and repairs a stale cookie", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "de", domain: "localhost", path: "/" },
  ]);

  await page.goto("/it");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen$/);

  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe(
    "en",
  );
  expect(cookies.find((cookie) => cookie.name === "grm.locale")?.value).toBe(
    "en",
  );
});

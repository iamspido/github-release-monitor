import { expect, test } from "./fixtures/ensureLoggedIn";

test("Forgejo diagnostics explain when no additional instances are configured", async ({
  page,
}) => {
  await page.goto("/en/test");

  await expect(
    page.getByText("Forgejo API Status", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Checks connectivity and authentication with configured Forgejo instances.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No additional Forgejo instances are configured."),
  ).toBeVisible();
});

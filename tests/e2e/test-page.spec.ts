import { expect, test } from "./fixtures/ensureLoggedIn";

test("apprise not configured notice and disabled actions", async ({ page }) => {
  await page.goto("/en/test");
  await expect(page.getByText("Apprise is not configured.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh Status" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send Test Notification" }),
  ).toBeDisabled();
  // "Trigger Check" requires at least one notification service
  await expect(
    page.getByRole("button", { name: "Trigger Check" }),
  ).toBeDisabled();
});

test("send direct test email button is disabled without SMTP config", async ({
  page,
}) => {
  await page.goto("/en/test");
  const btn = page.getByRole("button", { name: "Send Direct Test Email" });
  await expect(btn).toBeDisabled();
});

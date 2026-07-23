import { expect, test } from "./fixtures/ensureLoggedIn";

test("GitHub token hint visible when token is not set", async ({ page }) => {
  await page.goto("/en/test");

  // Status indicator and hint text
  await expect(page.getByText("GITHUB_ACCESS_TOKEN not set.")).toBeVisible();
  await expect(
    page.getByText(
      "The app will work, but you may be rate-limited by GitHub (60 requests/hour). Add a token to your .env file for a higher limit (5000 requests/hour).",
    ),
  ).toBeVisible();

  // Codeberg token indicator and hint text
  await expect(page.getByText("CODEBERG_ACCESS_TOKEN not set.")).toBeVisible();
  await expect(
    page.getByText(
      "The app will work without a token for public repositories. Add CODEBERG_ACCESS_TOKEN to access private repositories and to reduce the chance of rate limiting.",
    ),
  ).toBeVisible();
});

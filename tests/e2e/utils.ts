import { expect, type Locator, type Page } from "@playwright/test";
import type { Locale } from "../../src/i18n/config";
import {
  hasAuthenticationSessionCookie,
  hasTestRepoBaselineCookie,
} from "./fixtures/cookies";

async function waitForAutosaveIndicator(page: Page, timeoutMs: number) {
  await expect(
    page.locator('[data-testid="autosave-status"][data-status="success"]'),
  ).toBeVisible({ timeout: timeoutMs });
}

export async function waitForAutosave(
  page: Page,
  action: () => Promise<unknown>,
  timeoutMs = 8000,
) {
  const requestPromise = page.waitForRequest(
    (request) => {
      return (
        request.method() === "POST" &&
        request.headers()["next-action"] !== undefined
      );
    },
    { timeout: timeoutMs },
  );

  const [request] = await Promise.all([requestPromise, action()]);
  const response = await request.response();
  if (!response) {
    throw new Error("Autosave server action completed without a response.");
  }
  expect(
    response.ok(),
    `Autosave server action returned ${response.status()}.`,
  ).toBe(true);
  await waitForAutosaveIndicator(page, timeoutMs);
}

export async function assertNoAutosave(page: Page, waitMs = 1600) {
  await page.waitForTimeout(waitMs);
  await expect(
    page.locator('[data-testid="autosave-status"][data-status="success"]'),
  ).toHaveCount(0);
}

export async function waitForTestRepoReady(page: Page, timeoutMs = 8_000) {
  await expect(
    page.locator(
      '[data-testid="test-repository-result"][data-result="success"]',
    ),
  ).toBeVisible({ timeout: timeoutMs });
}

export async function ensureTestRepo(page: Page, timeoutMs = 8_000) {
  if (hasTestRepoBaselineCookie(await page.context().cookies())) {
    return;
  }

  await page.goto("/test");
  await page.getByTestId("setup-test-repository").click();
  await waitForTestRepoReady(page, timeoutMs);
}

export async function waitForRepoLink(
  page: Page,
  repoId = "test/test",
  timeoutMs = 15_000,
) {
  const link = page.locator("a", { hasText: repoId });
  await expect(link.first()).toBeVisible({ timeout: timeoutMs });
  return link;
}

export async function waitForRepositoryUpdate(page: Page, timeoutMs = 15_000) {
  const result = page.locator('[data-testid="repository-update-result"]');
  await expect(result).toBeVisible({ timeout: timeoutMs });
  await expect(result).toHaveAttribute("data-result", "success");
}

export async function ensureRepositoryFormExpanded(page: Page) {
  const toggleButton = page.getByTestId("repository-form-toggle");

  await expect(toggleButton).toBeVisible();

  if ((await toggleButton.getAttribute("aria-expanded")) !== "true") {
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute("aria-expanded", "true");
  }

  await expect(page.locator('textarea[name="urls"]')).toBeVisible();
  await expect(page.getByTestId("add-repositories")).toBeVisible();
}

export async function removeRepositoriesIfPresent(
  page: Page,
  repositoryIds: readonly string[],
) {
  await page.goto("/");

  for (const repositoryId of repositoryIds) {
    const repositoryLink = page.locator("a", { hasText: repositoryId }).first();
    if ((await repositoryLink.count()) === 0) continue;

    const repositoryCard = repositoryLink.locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]",
    );
    await repositoryCard.getByTestId("remove-repository").click();

    const confirmationDialog = page.getByRole("alertdialog");
    await expect(confirmationDialog).toBeVisible();
    await confirmationDialog.getByTestId("confirm-remove-repository").click();
    await expect(confirmationDialog).toHaveCount(0);
    await expect(repositoryLink).toHaveCount(0);
  }
}

export async function assertNotVisibleFor(locator: Locator, waitMs = 1600) {
  await locator.page().waitForTimeout(waitMs);
  await expect(locator).toHaveCount(0);
}

export async function waitForLocale(
  page: Page,
  expected: Locale,
  timeoutMs = 8000,
) {
  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies();
        const c = cookies.find(
          (c) =>
            c.name === "NEXT_LOCALE" &&
            (c.domain === "localhost" || c.domain.endsWith(".localhost")),
        );
        return c?.value || "";
      },
      { timeout: timeoutMs, intervals: [200] },
    )
    .toBe(expected);
}

// Set the browser state before dispatching the event so a component that
// hydrates after the event still reads the intended navigator.onLine value.
export async function goOffline(page: Page, waitMs = 450) {
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(waitMs);
}

export async function goOnline(page: Page, waitMs = 450) {
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(waitMs);
}

async function hasSessionCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return hasAuthenticationSessionCookie(cookies);
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  if (await hasSessionCookie(page)) {
    return true;
  }
  return page
    .getByTestId("logout-button")
    .isVisible()
    .catch(() => false);
}

export async function ensureAuthenticated(page: Page): Promise<void> {
  if (!(await isLoggedIn(page))) {
    await login(page);
  }
}

export async function login(
  page: Page,
  email?: string,
  password?: string,
  timeoutMs = 20_000,
) {
  const u =
    email ||
    process.env.AUTH_EMAIL ||
    process.env.AUTH_USERNAME ||
    "test@example.test";
  const p = password || process.env.AUTH_PASSWORD || "TestPassword123";
  const setupToken = process.env.AUTH_SETUP_TOKEN || "x".repeat(64);

  if (await isLoggedIn(page)) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    return;
  }

  const tryGotoLogin = async () => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
  };

  await tryGotoLogin();

  const setupTokenField = page.locator('input[name="setupToken"]');
  const usernameField = page.locator('input[name="email"]');
  const passwordField = page.locator('input[name="password"]');
  try {
    await expect
      .poll(
        async () =>
          (await isLoggedIn(page)) ||
          (await setupTokenField.count()) > 0 ||
          ((await usernameField.count()) > 0 &&
            (await passwordField.count()) > 0),
        {
          timeout: timeoutMs,
          intervals: [100, 250, 500],
        },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`Unable to reach login page, current URL: ${page.url()}`, {
      cause: error,
    });
  }

  if (await isLoggedIn(page)) return;

  if ((await setupTokenField.count()) > 0) {
    await setupTokenField.first().fill(setupToken, { timeout: timeoutMs });
    await page
      .locator('input[name="name"]')
      .fill("E2E Admin", { timeout: timeoutMs });
    await page.locator('input[name="email"]').fill(u, { timeout: timeoutMs });
    await page
      .locator('input[name="password"]')
      .fill(p, { timeout: timeoutMs });
    await page.locator('button[type="submit"]').first().click({
      timeout: timeoutMs,
    });
    await expect(setupTokenField).toHaveCount(0, { timeout: timeoutMs });
  }

  if (
    (await usernameField.count()) === 0 ||
    (await passwordField.count()) === 0
  ) {
    if (await isLoggedIn(page)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      return;
    }
    await tryGotoLogin();
  }

  await usernameField.waitFor({ state: "visible", timeout: timeoutMs });
  await usernameField.fill(u, { timeout: timeoutMs });

  await passwordField.waitFor({ state: "visible", timeout: timeoutMs });
  await passwordField.fill(p, { timeout: timeoutMs });

  const loginButton = page.locator('button[type="submit"]').first();
  await loginButton.click({ timeout: timeoutMs });
  await expect.poll(() => isLoggedIn(page), { timeout: timeoutMs }).toBe(true);
}

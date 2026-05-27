import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function requestForIntent(value: string) {
  return new Request("https://example.test/login", {
    headers: {
      cookie: `other=value; auth_social_login_intent=${value}; theme=dark`,
    },
  });
}

describe("auth/social-login-intent", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    process.env = {
      ...ORIGINAL_ENV,
      BETTER_AUTH_SECRET: "social-login-test-secret",
      HTTPS: "false",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it("round-trips a signed register intent with normalized form fields", async () => {
    const { buildSocialLoginIntentValue, readSocialLoginIntentFromRequest } =
      await import("@/lib/auth/social-login-intent");

    const value = buildSocialLoginIntentValue("github", {
      purpose: "register",
      username: " Release.Bot ",
      email: " USER@Example.TEST ",
    });

    const intent = readSocialLoginIntentFromRequest(requestForIntent(value));

    expect(intent).toMatchObject({
      provider: "github",
      purpose: "register",
      issuedAt: Date.parse("2024-01-01T12:00:00.000Z"),
      expiresAt: Date.parse("2024-01-01T12:02:00.000Z"),
      username: "Release.Bot",
      email: "user@example.test",
    });
    expect(intent?.nonce).toEqual(expect.any(String));
  });

  it("rejects tampered or expired intent cookies", async () => {
    const { buildSocialLoginIntentValue, readSocialLoginIntentFromRequest } =
      await import("@/lib/auth/social-login-intent");

    const value = buildSocialLoginIntentValue("google");

    expect(
      readSocialLoginIntentFromRequest(requestForIntent(`${value}x`)),
    ).toBeNull();

    vi.advanceTimersByTime(121_000);

    expect(
      readSocialLoginIntentFromRequest(requestForIntent(value)),
    ).toBeNull();
  });

  it("rejects register intents with invalid usernames", async () => {
    const { buildSocialLoginIntentValue, readSocialLoginIntentFromRequest } =
      await import("@/lib/auth/social-login-intent");

    const value = buildSocialLoginIntentValue("github", {
      purpose: "register",
      username: "no spaces",
      email: "user@example.test",
    });

    expect(
      readSocialLoginIntentFromRequest(requestForIntent(value)),
    ).toBeNull();
  });

  it("builds set and clear cookie headers with the expected security attributes", async () => {
    const { buildSocialLoginIntentSetCookieHeader } = await import(
      "@/lib/auth/social-login-intent"
    );

    expect(buildSocialLoginIntentSetCookieHeader("abc.def")).toBe(
      "auth_social_login_intent=abc.def; Path=/; HttpOnly; SameSite=Lax; Max-Age=120",
    );
    expect(buildSocialLoginIntentSetCookieHeader(null)).toBe(
      "auth_social_login_intent=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function requestForContext(value: string | null) {
  return new Request("https://example.test/login", {
    headers: value
      ? {
          cookie: `other=value; auth_setup_social_context=${value}; theme=dark`,
        }
      : {},
  });
}

describe("auth/setup-social-context", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    process.env = {
      ...ORIGINAL_ENV,
      BETTER_AUTH_SECRET: "setup-social-test-secret",
      HTTPS: "false",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it("round-trips a signed setup context with normalized profile fields", async () => {
    const { buildSetupSocialContextValue, readSetupSocialContextFromRequest } =
      await import("@/lib/auth/setup-social-context");

    const value = buildSetupSocialContextValue({
      username: " Release.Bot ",
      name: " Release Bot ",
    });

    expect(readSetupSocialContextFromRequest(requestForContext(value))).toEqual(
      {
        username: "Release.Bot",
        name: "Release Bot",
        issuedAt: Date.parse("2024-01-01T12:00:00.000Z"),
        expiresAt: Date.parse("2024-01-01T12:10:00.000Z"),
      },
    );
  });

  it("rejects missing, malformed, tampered, expired, or empty-username cookies", async () => {
    const { buildSetupSocialContextValue, readSetupSocialContextFromRequest } =
      await import("@/lib/auth/setup-social-context");

    const value = buildSetupSocialContextValue({
      username: "Release.Bot",
      name: "",
    });
    const emptyUsernameValue = buildSetupSocialContextValue({
      username: "   ",
    });

    expect(
      readSetupSocialContextFromRequest(requestForContext(null)),
    ).toBeNull();
    expect(
      readSetupSocialContextFromRequest(requestForContext("not-a-token")),
    ).toBeNull();
    expect(
      readSetupSocialContextFromRequest(requestForContext(`${value}x`)),
    ).toBeNull();
    expect(
      readSetupSocialContextFromRequest(requestForContext(emptyUsernameValue)),
    ).toBeNull();

    vi.advanceTimersByTime(600_001);

    expect(
      readSetupSocialContextFromRequest(requestForContext(value)),
    ).toBeNull();
  });

  it("builds set and clear cookie headers without Secure when HTTPS=false", async () => {
    const { buildSetupSocialContextSetCookieHeader } = await import(
      "@/lib/auth/setup-social-context"
    );

    expect(buildSetupSocialContextSetCookieHeader("abc.def")).toBe(
      "auth_setup_social_context=abc.def; Path=/; HttpOnly; SameSite=Lax; Max-Age=600",
    );
    expect(buildSetupSocialContextSetCookieHeader(null)).toBe(
      "auth_setup_social_context=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("adds Secure to cookie headers by default", async () => {
    delete process.env.HTTPS;
    const { buildSetupSocialContextSetCookieHeader } = await import(
      "@/lib/auth/setup-social-context"
    );

    expect(buildSetupSocialContextSetCookieHeader("abc.def")).toBe(
      "auth_setup_social_context=abc.def; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
    );
    expect(buildSetupSocialContextSetCookieHeader(null)).toBe(
      "auth_setup_social_context=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });
});

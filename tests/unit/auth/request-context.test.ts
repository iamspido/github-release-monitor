import { afterEach, describe, expect, it } from "vitest";
import {
  getClientIpFromHeaders,
  getLoginIdentifierLogLabel,
  getLoginRequestContext,
} from "@/lib/auth/request-context";

describe("auth request context", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the trusted side of a forwarded chain", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.20",
    });

    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.20");
  });

  it("allows deployments to disable proxy-derived client addresses", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";
    const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });

    expect(getClientIpFromHeaders(headers)).toBe("unknown");
  });

  it("does not store or log the raw login identifier", () => {
    const identifier = "Sensitive.User@example.com";
    const context = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.20" }),
      identifier,
    );
    const logLabel = getLoginIdentifierLogLabel(identifier);

    expect(context.rateLimitKey).toHaveLength(2);
    expect(context.rateLimitKey).toContain(context.accountRateLimitKey);
    expect(context.rateLimitKey.join(":")).not.toContain(identifier);
    expect(logLabel).not.toContain(identifier);
    expect(logLabel).toMatch(/^identifier_hash='[a-f0-9]{12}'$/);
  });

  it("scopes account login attempts to the client address", () => {
    const first = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.20" }),
      "user@example.com",
    );
    const second = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.21" }),
      "user@example.com",
    );

    expect(first.accountRateLimitKey).not.toBe(second.accountRateLimitKey);
  });

  it("does not create a globally shared account lockout without a client IP", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";

    const context = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.20" }),
      "user@example.com",
    );

    expect(context.rateLimitKey).toEqual([]);
    expect(context.accountRateLimitKey).toBeNull();
  });
});

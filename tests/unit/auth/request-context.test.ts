import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientIpFromHeaders,
  getExplicitlyTrustedClientIpFromRequest,
  getLoginIdentifierLogLabel,
  getLoginRequestContext,
} from "@/lib/auth/request-context";

describe("auth request context", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("uses the trusted side of a forwarded chain", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.20",
    });

    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.20");
  });

  it("preserves the 2.x proxy-header default when unset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.AUTH_TRUST_PROXY_HEADERS;
    const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });

    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.10");
    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.10");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("preserving the 2.x compatibility default"),
    );
  });

  it("allows direct deployments to reject proxy-derived addresses", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10",
      "x-real-ip": "198.51.100.20",
    });

    expect(getClientIpFromHeaders(headers)).toBe("unknown");
  });

  it("uses proxy addresses for security limits only when explicitly trusted", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    delete process.env.AUTH_TRUST_PROXY_HEADERS;
    expect(getExplicitlyTrustedClientIpFromRequest(request)).toBe("unknown");

    process.env.AUTH_TRUST_PROXY_HEADERS = "false";
    expect(getExplicitlyTrustedClientIpFromRequest(request)).toBe("unknown");

    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    expect(getExplicitlyTrustedClientIpFromRequest(request)).toBe(
      "203.0.113.10",
    );
  });

  it("does not store or log the raw login identifier", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    const identifier = "Sensitive.User@example.test";
    const context = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.20" }),
      identifier,
    );
    const logLabel = getLoginIdentifierLogLabel(identifier);

    expect(context.rateLimitKey).toHaveLength(3);
    expect(context.rateLimitKey).toContain(context.accountRateLimitKey);
    expect(context.rateLimitKey.join(":")).not.toContain(identifier);
    expect(logLabel).not.toContain(identifier);
    expect(logLabel).toMatch(/^identifier_hash='[a-f0-9]{12}'$/);
  });

  it("scopes account login attempts to the client address", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    const first = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.20" }),
      "user@example.test",
    );
    const second = getLoginRequestContext(
      new Headers({ "x-real-ip": "198.51.100.21" }),
      "user@example.test",
    );

    expect(first.accountRateLimitKey).not.toBe(second.accountRateLimitKey);
  });

  it("shares one account-wide bucket for an identifier across spoofed client addresses", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.AUTH_TRUST_PROXY_HEADERS;
    const first = getLoginRequestContext(
      new Headers({ "x-forwarded-for": "198.51.100.20" }),
      "user@example.test",
    );
    const second = getLoginRequestContext(
      new Headers({ "x-forwarded-for": "203.0.113.99" }),
      " User@Example.test ",
    );
    const otherAccount = getLoginRequestContext(
      new Headers({ "x-forwarded-for": "198.51.100.20" }),
      "other@example.test",
    );

    const shared = first.rateLimitKey.filter((key) =>
      second.rateLimitKey.includes(key),
    );

    expect(shared).toEqual([expect.stringMatching(/^account:[a-f0-9]{64}$/)]);
    expect(otherAccount.rateLimitKey).not.toContain(shared[0]);
  });

  it("keys long identifiers by their whole value, so two that share their first 128 characters share no account bucket", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    const sharedStart = `member@${"a".repeat(60)}.${"b".repeat(60)}`;
    const first = `${sharedStart}.first.test`;
    const second = `${sharedStart}.second.test`;
    const fromAddress = (identifier: string) =>
      getLoginRequestContext(
        new Headers({ "x-real-ip": "198.51.100.20" }),
        identifier,
      );
    const withoutAddress = (identifier: string) =>
      getLoginRequestContext(new Headers(), identifier);
    const shared = (a: readonly string[], b: readonly string[]) =>
      a.filter((key) => b.includes(key));
    const hashOf = (key: string) => key.slice(key.lastIndexOf(":") + 1);

    expect({
      sharedStartLength: sharedStart.length,
      sharedFromAddress: shared(
        fromAddress(first).rateLimitKey,
        fromAddress(second).rateLimitKey,
      ),
      sharedWithoutAddress: shared(
        withoutAddress(first).rateLimitKey,
        withoutAddress(second).rateLimitKey,
      ),
      sameIdentifierInOtherCase: {
        fromAddress: fromAddress(` ${first.toUpperCase()} `).rateLimitKey,
        withoutAddress: withoutAddress(` ${first.toUpperCase()} `).rateLimitKey,
      },
      logLabelsNameTheirBuckets: [first, second].map(
        (identifier) =>
          getLoginIdentifierLogLabel(identifier) ===
          `identifier_hash='${hashOf(
            fromAddress(identifier).accountWideRateLimitKey,
          ).slice(0, 12)}'`,
      ),
    }).toEqual({
      sharedStartLength: 128,
      sharedFromAddress: ["ip:198.51.100.20"],
      sharedWithoutAddress: [],
      sameIdentifierInOtherCase: {
        fromAddress: fromAddress(first).rateLimitKey,
        withoutAddress: withoutAddress(first).rateLimitKey,
      },
      logLabelsNameTheirBuckets: [true, true],
    });
  });

  it.each([
    ["unset", undefined],
    ["true", "true"],
    ["false", "false"],
  ] as const)(
    "with AUTH_TRUST_PROXY_HEADERS %s, a request without a client address shares the account-wide bucket of its identifier and keeps its identifier bucket",
    (_trust, trust) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      process.env.AUTH_TRUST_PROXY_HEADERS = "true";
      const withAddress = getLoginRequestContext(
        new Headers({ "x-forwarded-for": "198.51.100.20" }),
        "user@example.test",
      );
      if (trust === undefined) delete process.env.AUTH_TRUST_PROXY_HEADERS;
      else process.env.AUTH_TRUST_PROXY_HEADERS = trust;

      const withoutAddress = getLoginRequestContext(
        new Headers(),
        " User@Example.test ",
      );

      expect({
        clientIp: withoutAddress.clientIp,
        rateLimitKey: withoutAddress.rateLimitKey,
        accountRateLimitKey: withoutAddress.accountRateLimitKey,
        accountWideRateLimitKey: withoutAddress.accountWideRateLimitKey,
      }).toEqual({
        clientIp: "unknown",
        rateLimitKey: [
          expect.stringMatching(/^identifier:[a-f0-9]{64}$/),
          withAddress.accountWideRateLimitKey,
        ],
        accountRateLimitKey: withoutAddress.rateLimitKey[0],
        accountWideRateLimitKey: withAddress.accountWideRateLimitKey,
      });
      expect(withAddress.accountWideRateLimitKey).toMatch(
        /^account:[a-f0-9]{64}$/,
      );
    },
  );

  it("uses a stable identifier hash when no trusted client IP is available", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";

    const context = getLoginRequestContext(
      new Headers({
        "x-real-ip": "198.51.100.20",
        "user-agent": "test-browser",
        "accept-language": "en-US",
      }),
      "user@example.test",
    );

    expect(context.rateLimitKey).toHaveLength(2);
    expect(context.accountRateLimitKey).toMatch(/^identifier:[a-f0-9]{64}$/);
    expect(context.rateLimitKey.join(":")).not.toContain("test-browser");
    expect(context.rateLimitKey.join(":")).not.toContain("user@example.test");
  });

  it("does not let client-controlled headers rotate fallback rate limits", () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";

    const first = getLoginRequestContext(
      new Headers({ "user-agent": "first-browser" }),
      "user@example.test",
    );
    const second = getLoginRequestContext(
      new Headers({ "user-agent": "second-browser" }),
      "user@example.test",
    );

    expect(first.rateLimitKey).toEqual(second.rateLimitKey);
    expect(first.accountRateLimitKey).toBe(second.accountRateLimitKey);
  });
});

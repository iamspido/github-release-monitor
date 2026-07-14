import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("login rate limit storage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("evicts least-recently-used entries when the store reaches its limit", async () => {
    const {
      getFailedLoginFailures,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index <= MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index);
    }

    const store = (globalThis as typeof globalThis & {
      _authLoginAttempts?: Map<string, unknown>;
    })._authLoginAttempts;
    expect(store?.size).toBe(MAX_LOGIN_RATE_LIMIT_ENTRIES);
    expect(getFailedLoginFailures("client:0")).toBe(0);
    expect(
      getFailedLoginFailures(`client:${MAX_LOGIN_RATE_LIMIT_ENTRIES}`),
    ).toBe(1);
  });

  it("runs the full expiry sweep at most once per pruning interval", async () => {
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "1";
    const {
      getFailedLoginFailures,
      pruneFailedLoginState,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:old", 0);
    pruneFailedLoginState(1);
    pruneFailedLoginState(2_000);
    expect(getFailedLoginFailures("client:old")).toBe(1);

    pruneFailedLoginState(60_001);
    expect(getFailedLoginFailures("client:old")).toBe(0);
  });

  it("activates a lockout on the first failure when the limit is one", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    const { isLoginRateLimited, registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );

    const result = registerFailedLoginAttempt("client:locked", 0);

    expect(result.lockoutTriggered).toBe(true);
    expect(isLoginRateLimited("client:locked", 1)).toBe(true);
  });

  it("keeps actively blocked clients recent during LRU eviction", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:locked", 0);
    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES - 1; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index);
    }

    expect(isLoginRateLimited("client:locked", 1)).toBe(true);
    registerFailedLoginAttempt("client:new", 2);

    expect(isLoginRateLimited("client:locked", 2)).toBe(true);
  });
});

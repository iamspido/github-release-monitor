import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("login rate limit storage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginOverflowAttempts =
      undefined;
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

    const store = (
      globalThis as typeof globalThis & {
        _authLoginAttempts?: Map<string, unknown>;
      }
    )._authLoginAttempts;
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

  it("never evicts an active lockout to admit a new client", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    const {
      getFailedLoginFailures,
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:locked", 0);
    registerFailedLoginAttempt("client:locked", 1);
    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES - 1; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index + 2);
    }

    registerFailedLoginAttempt("client:new", MAX_LOGIN_RATE_LIMIT_ENTRIES + 2);

    expect(
      isLoginRateLimited("client:locked", MAX_LOGIN_RATE_LIMIT_ENTRIES + 3),
    ).toBe(true);
    expect(getFailedLoginFailures("client:locked")).toBe(2);
    expect(getFailedLoginFailures("client:0")).toBe(0);
    expect(getFailedLoginFailures("client:new")).toBe(1);
  });

  it("scopes overflow lockouts when every primary entry is active", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, 0);
    }
    registerFailedLoginAttempt("client:overflow", 1);

    expect(isLoginRateLimited("client:overflow", 2)).toBe(true);
    expect(isLoginRateLimited("client:unseen", 2)).toBe(false);
    expect(isLoginRateLimited("client:overflow", 60_001)).toBe(false);
  });

  it("bounds exact overflow entries without globally blocking new clients", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:primary:${index}`, 0);
    }
    for (
      let index = 0;
      index < MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES;
      index += 1
    ) {
      registerFailedLoginAttempt(`client:overflow:${index}`, 1);
    }
    registerFailedLoginAttempt("client:overflow:new", 2);

    const overflowStore = (
      globalThis as typeof globalThis & {
        _authLoginOverflowAttempts?: Map<string, unknown>;
      }
    )._authLoginOverflowAttempts;
    expect(overflowStore?.size).toBe(MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES);
    expect(isLoginRateLimited("client:primary:0", 3)).toBe(true);
    expect(isLoginRateLimited("client:overflow:0", 3)).toBe(false);
    expect(isLoginRateLimited("client:overflow:new", 3)).toBe(true);
    expect(isLoginRateLimited("client:unseen", 3)).toBe(false);
  });
});

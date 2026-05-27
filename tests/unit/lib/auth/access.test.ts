import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureAuthDatabaseReady: vi.fn(),
}));

const headersMock = vi.hoisted(() => vi.fn());

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  withScope: vi.fn(),
}));

loggerMock.withScope.mockReturnValue(loggerMock);

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: authMocks.getSession,
    },
  },
  ensureAuthDatabaseReady: authMocks.ensureAuthDatabaseReady,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

describe("auth/access", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.getSession.mockReset();
    authMocks.ensureAuthDatabaseReady.mockReset();
    headersMock.mockReset();
    loggerMock.error.mockReset();
    delete process.env.AUTHENTICATION_METHOD;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("grants external auth access without checking an internal session", async () => {
    const { getAuthAccessForHeaders } = await import("@/lib/auth/access");

    const access = await getAuthAccessForHeaders(new Headers(), "External");

    expect(access).toMatchObject({
      authenticationMethod: "External",
      isAuthenticated: false,
      canMutate: true,
      showLogin: false,
      showLogout: false,
    });
    expect(authMocks.ensureAuthDatabaseReady).not.toHaveBeenCalled();
    expect(authMocks.getSession).not.toHaveBeenCalled();
  });

  it("uses the internal Better Auth session for Basic access", async () => {
    authMocks.ensureAuthDatabaseReady.mockResolvedValue(undefined);
    authMocks.getSession.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1" },
    });
    const requestHeaders = new Headers({ cookie: "session=abc" });
    const { getAuthAccessForHeaders } = await import("@/lib/auth/access");

    const access = await getAuthAccessForHeaders(requestHeaders, "Basic");

    expect(authMocks.ensureAuthDatabaseReady).toHaveBeenCalledTimes(1);
    expect(authMocks.getSession).toHaveBeenCalledWith({
      headers: requestHeaders,
    });
    expect(access).toMatchObject({
      authenticationMethod: "Basic",
      isAuthenticated: true,
      canMutate: true,
      showLogin: false,
      showLogout: true,
    });
  });

  it("falls back to read-only access when session validation fails outside test bypass", async () => {
    vi.stubEnv("AUTHENTICATION_METHOD", "Basic");
    authMocks.ensureAuthDatabaseReady.mockRejectedValue(new Error("db down"));
    const { getAuthAccessForHeaders } = await import("@/lib/auth/access");

    const access = await getAuthAccessForHeaders(new Headers());

    expect(access).toMatchObject({
      isAuthenticated: false,
      canMutate: false,
      showLogin: true,
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Failed to validate session for auth access.",
      expect.any(Error),
    );
  });

  it("uses request headers from Next when checking the current auth access", async () => {
    authMocks.ensureAuthDatabaseReady.mockResolvedValue(undefined);
    authMocks.getSession.mockResolvedValue(null);
    const requestHeaders = new Headers();
    headersMock.mockResolvedValue(requestHeaders);
    const { canPerformRestrictedAction, getCurrentAuthAccess } = await import(
      "@/lib/auth/access"
    );

    await expect(getCurrentAuthAccess()).resolves.toMatchObject({
      isAuthenticated: false,
      canMutate: false,
    });
    await expect(canPerformRestrictedAction()).resolves.toBe(false);
    expect(headersMock).toHaveBeenCalled();
  });
});

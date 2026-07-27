import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const missingColumnMock = vi.fn();

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => ({ prepare: prepareMock }),
}));

vi.mock("@/lib/auth/repository-schema", () => ({
  isSqliteMissingColumnError: (error: unknown) => missingColumnMock(error),
}));

vi.mock("@/lib/logger", () => {
  const scoped = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return { logger: { withScope: () => scoped } };
});

function requestWithCookie(cookie?: string) {
  return new Request("https://example.test/auth/callback", {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("auth repository session checks", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    missingColumnMock.mockReset();
    missingColumnMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["has_user", { id: "user-1" }],
    ["no_user", undefined],
  ] as const)("reports %s from the user table", async (expected, row) => {
    prepareMock.mockReturnValue({ get: vi.fn(() => row) });
    const { hasAnyAuthUser } = await import("@/lib/auth/repository-session");

    expect(hasAnyAuthUser()).toBe(expected);
    expect(prepareMock).toHaveBeenCalledWith("SELECT id FROM user LIMIT 1");
  });

  it("returns unknown when user lookup fails", async () => {
    prepareMock.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const { hasAnyAuthUser } = await import("@/lib/auth/repository-session");

    expect(hasAnyAuthUser()).toBe("unknown");
  });

  it.each([
    "better-auth.session_token=session%20token",
    "__Secure-better-auth.session_token=session%20token",
  ])("accepts a valid future session from %s", async (cookie) => {
    const get = vi.fn(() => ({
      userId: "user-1",
      expiresAt: Date.now() + 60_000,
    }));
    prepareMock.mockReturnValue({ get });
    const { hasValidAuthSessionForRequest } = await import(
      "@/lib/auth/repository-session"
    );

    expect(hasValidAuthSessionForRequest(requestWithCookie(cookie))).toBe(true);
    expect(get).toHaveBeenCalledWith("session token");
  });

  it("falls back to the legacy snake_case session schema", async () => {
    const schemaError = new Error("no such column: userId");
    missingColumnMock.mockImplementation((error) => error === schemaError);
    const legacyGet = vi.fn(() => ({
      user_id: "user-1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }));
    prepareMock
      .mockReturnValueOnce({
        get: vi.fn(() => {
          throw schemaError;
        }),
      })
      .mockReturnValueOnce({ get: legacyGet });
    const { hasValidAuthSessionForRequest } = await import(
      "@/lib/auth/repository-session"
    );

    expect(
      hasValidAuthSessionForRequest(
        requestWithCookie("better-auth.session_token=legacy"),
      ),
    ).toBe(true);
    expect(legacyGet).toHaveBeenCalledWith("legacy");
  });

  it.each([
    ["no cookie", undefined, undefined],
    ["empty token", "better-auth.session_token=", undefined],
    ["malformed encoding", "better-auth.session_token=%", undefined],
    [
      "missing user id",
      "better-auth.session_token=token",
      { expiresAt: Date.now() + 60_000 },
    ],
    [
      "expired session",
      "better-auth.session_token=token",
      { userId: "user-1", expiresAt: Date.now() - 1 },
    ],
    [
      "missing expiry",
      "better-auth.session_token=token",
      { userId: "user-1", expiresAt: null },
    ],
    [
      "invalid expiry",
      "better-auth.session_token=token",
      { userId: "user-1", expiresAt: "not-a-date" },
    ],
  ])("rejects %s", async (_label, cookie, row) => {
    prepareMock.mockReturnValue({ get: vi.fn(() => row) });
    const { hasValidAuthSessionForRequest } = await import(
      "@/lib/auth/repository-session"
    );

    expect(hasValidAuthSessionForRequest(requestWithCookie(cookie))).toBe(
      false,
    );
  });

  it("fails closed on non-schema database errors", async () => {
    prepareMock.mockReturnValue({
      get: vi.fn(() => {
        throw new Error("database unavailable");
      }),
    });
    const { hasValidAuthSessionForRequest } = await import(
      "@/lib/auth/repository-session"
    );

    expect(
      hasValidAuthSessionForRequest(
        requestWithCookie("better-auth.session_token=token"),
      ),
    ).toBe(false);
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });
});

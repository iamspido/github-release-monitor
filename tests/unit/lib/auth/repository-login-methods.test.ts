const mocks = vi.hoisted(() => ({
  enabledProviders: ["github"] as string[],
  passkeyEnabled: true,
  prepare: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({
  getEnabledSocialProviders: () => mocks.enabledProviders,
  isAuthPasskeyEnabled: () => mocks.passkeyEnabled,
}));

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => ({ prepare: mocks.prepare }),
}));

vi.mock("@/lib/auth/repository-schema", () => ({
  isSqliteMissingColumnError: (error: unknown) =>
    error instanceof Error && error.message === "missing column",
  isSqliteMissingTableError: (error: unknown) =>
    error instanceof Error && error.message === "missing table",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

describe("auth/repository-login-methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabledProviders = ["github"];
    mocks.passkeyEnabled = true;
  });

  it("rejects empty account lookup identifiers without querying SQLite", async () => {
    const {
      hasCredentialPasswordAccount,
      hasLinkedSocialProviderAccount,
      hasPasskeyForUser,
      hasVerifiedTotpForUser,
    } = await import("@/lib/auth/repository-login-methods");

    expect(hasCredentialPasswordAccount(" ")).toBe(false);
    expect(hasLinkedSocialProviderAccount("", "github")).toBe(false);
    expect(hasPasskeyForUser(" ")).toBe(false);
    expect(hasVerifiedTotpForUser("")).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("finds credential accounts through a legacy schema fallback", async () => {
    mocks.prepare
      .mockReturnValueOnce({
        get: vi.fn(() => {
          throw new Error("missing column");
        }),
      })
      .mockReturnValueOnce({ get: vi.fn(() => ({ id: "credential-1" })) });
    const { hasCredentialPasswordAccount } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(hasCredentialPasswordAccount(" user-1 ")).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("fails closed when credential or social account lookup fails", async () => {
    mocks.prepare.mockReturnValue({
      get: vi.fn(() => {
        throw new Error("database unavailable");
      }),
    });
    const { hasCredentialPasswordAccount, hasLinkedSocialProviderAccount } =
      await import("@/lib/auth/repository-login-methods");

    expect(hasCredentialPasswordAccount("user-1")).toBe(false);
    expect(hasLinkedSocialProviderAccount("user-1", "github")).toBe(false);
  });

  it("collects only linked supported social providers", async () => {
    mocks.prepare.mockImplementation(() => ({
      get: vi.fn((_userId: string, provider: string) =>
        provider === "google" ? { id: "google-1" } : undefined,
      ),
    }));
    const { getLinkedSocialProvidersForUser } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(getLinkedSocialProvidersForUser("user-1")).toEqual(["google"]);
  });

  it.each([true, 1, "1"] as const)(
    "accepts a verified TOTP row when the user flag is %j",
    async (enabledFlag) => {
      mocks.prepare.mockImplementation((query: string) => {
        if (query.includes("FROM user")) {
          return {
            get: vi.fn(() => ({ twoFactorEnabled: enabledFlag })),
          };
        }
        if (query.includes("FROM twoFactor")) {
          return { get: vi.fn(() => ({ id: "totp-1" })) };
        }
        throw new Error(`Unexpected query: ${query}`);
      });
      const { hasVerifiedTotpForUser } = await import(
        "@/lib/auth/repository-login-methods"
      );

      expect(hasVerifiedTotpForUser("user-1")).toBe(true);
    },
  );

  it("does not query TOTP secrets when the user flag is disabled", async () => {
    mocks.prepare.mockReturnValue({
      get: vi.fn(() => ({ twoFactorEnabled: false })),
    });
    const { hasVerifiedTotpForUser } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(hasVerifiedTotpForUser("user-1")).toBe(false);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it("falls back across legacy TOTP table and column names", async () => {
    mocks.prepare.mockImplementation((query: string) => {
      if (query.includes("FROM user")) {
        return { get: vi.fn(() => ({ twoFactorEnabled: 1 })) };
      }
      if (query.includes("FROM twoFactor")) {
        return {
          get: vi.fn(() => {
            throw new Error("missing column");
          }),
        };
      }
      if (query.includes("FROM two_factor") && query.includes("userId")) {
        return {
          get: vi.fn(() => {
            throw new Error("missing table");
          }),
        };
      }
      if (query.includes("FROM two_factor")) {
        return { get: vi.fn(() => ({ id: "totp-legacy" })) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { hasVerifiedTotpForUser } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(hasVerifiedTotpForUser("user-1")).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(5);
  });

  it("finds passkeys through the legacy user_id column", async () => {
    mocks.prepare
      .mockReturnValueOnce({
        get: vi.fn(() => {
          throw new Error("missing column");
        }),
      })
      .mockReturnValueOnce({ get: vi.fn(() => ({ id: "passkey-1" })) });
    const { hasPasskeyForUser } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(hasPasskeyForUser("user-1")).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("rejects passkey deletion when disabled, blank, or not owned by the user", async () => {
    const { canDeletePasskeyForUser } = await import(
      "@/lib/auth/repository-login-methods"
    );

    expect(canDeletePasskeyForUser("", "passkey-1")).toBe(false);
    expect(canDeletePasskeyForUser("user-1", "")).toBe(false);
    mocks.passkeyEnabled = false;
    expect(canDeletePasskeyForUser("user-1", "passkey-1")).toBe(false);

    mocks.passkeyEnabled = true;
    mocks.prepare.mockReturnValue({
      all: vi.fn(() => [{ id: "different-passkey" }]),
    });
    expect(canDeletePasskeyForUser("user-1", "passkey-1")).toBe(false);
  });
});

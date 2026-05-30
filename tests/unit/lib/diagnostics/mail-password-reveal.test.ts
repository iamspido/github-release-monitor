const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  verifyTOTP: vi.fn(),
  ensureAuthDatabaseReady: vi.fn(),
  hasCredentialPasswordAccount: vi.fn(),
  hasVerifiedTotpForUser: vi.fn(),
  hasPasskeyForUser: vi.fn(),
  getLinkedSocialProvidersForUser: vi.fn(),
  buildSocialLoginIntentValue: vi.fn(),
  setSocialLoginIntentCookie: vi.fn(),
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.25" }),
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/lib/auth/access", () => ({
  getCurrentAuthAccess: mocks.access,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      signInEmail: mocks.signInEmail,
      verifyTOTP: mocks.verifyTOTP,
    },
  },
  ensureAuthDatabaseReady: mocks.ensureAuthDatabaseReady,
  hasCredentialPasswordAccount: mocks.hasCredentialPasswordAccount,
  hasVerifiedTotpForUser: mocks.hasVerifiedTotpForUser,
  hasPasskeyForUser: mocks.hasPasskeyForUser,
  getLinkedSocialProvidersForUser: mocks.getLinkedSocialProvidersForUser,
}));

vi.mock("@/lib/auth/social-login-intent", () => ({
  buildSocialLoginIntentValue: mocks.buildSocialLoginIntentValue,
  setSocialLoginIntentCookie: mocks.setSocialLoginIntentCookie,
}));

describe("revealMailPasswordActionImpl", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...env,
      MAIL_PASSWORD: "mail-secret",
      APPRISE_URL: "http://user:pass@apprise:8000/notify/key",
    };
    mocks.access.mockReset();
    mocks.getSession.mockReset();
    mocks.signInEmail.mockReset();
    mocks.verifyTOTP.mockReset();
    mocks.ensureAuthDatabaseReady.mockReset();
    mocks.hasCredentialPasswordAccount.mockReset();
    mocks.hasVerifiedTotpForUser.mockReset();
    mocks.hasPasskeyForUser.mockReset();
    mocks.getLinkedSocialProvidersForUser.mockReset();
    mocks.buildSocialLoginIntentValue.mockReset();
    mocks.setSocialLoginIntentCookie.mockReset();
    mocks.cookieSet.mockReset();
    mocks.cookieGet.mockReset();
    mocks.ensureAuthDatabaseReady.mockResolvedValue(undefined);
    mocks.hasCredentialPasswordAccount.mockReturnValue(true);
    mocks.hasVerifiedTotpForUser.mockReturnValue(false);
    mocks.hasPasskeyForUser.mockReturnValue(false);
    mocks.getLinkedSocialProvidersForUser.mockReturnValue([]);
    mocks.buildSocialLoginIntentValue.mockReturnValue("intent.value");
    mocks.cookieGet.mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("reveals immediately for authorized external auth", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "External",
      canAccessRestrictedPages: true,
    });
    const { revealMailPasswordActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(revealMailPasswordActionImpl()).resolves.toEqual({
      success: true,
      value: "mail-secret",
    });
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });

  it("reveals the raw Apprise URL for authorized external auth", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "External",
      canAccessRestrictedPages: true,
    });
    const { revealAppriseUrlActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(revealAppriseUrlActionImpl()).resolves.toEqual({
      success: true,
      value: "http://user:pass@apprise:8000/notify/key",
    });
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated requests", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: false,
    });
    const { revealMailPasswordActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(revealMailPasswordActionImpl()).resolves.toEqual({
      success: false,
      errorKey: "error_auth_required",
    });
  });

  it("requires and verifies the current password for internal auth", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: true,
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.signInEmail.mockResolvedValue({ ok: true });
    const { revealMailPasswordActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(
      revealMailPasswordActionImpl({ currentPassword: "current-pass" }),
    ).resolves.toEqual({ success: true, value: "mail-secret" });
    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "user@example.com", password: "current-pass" },
      }),
    );
  });

  it("rejects wrong current passwords", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: true,
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.signInEmail.mockResolvedValue({ ok: false });
    const { revealMailPasswordActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(
      revealMailPasswordActionImpl({ currentPassword: "wrong" }),
    ).resolves.toEqual({
      success: false,
      errorKey: "error_current_password_invalid",
    });
  });

  it("returns available reveal step-up methods for the current account", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: true,
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.hasCredentialPasswordAccount.mockReturnValue(true);
    mocks.hasVerifiedTotpForUser.mockReturnValue(true);
    mocks.hasPasskeyForUser.mockReturnValue(true);
    mocks.getLinkedSocialProvidersForUser.mockReturnValue(["github"]);
    const { getSecretRevealOptionsActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(getSecretRevealOptionsActionImpl()).resolves.toEqual({
      success: true,
      methods: {
        password: true,
        totp: true,
        passkey: true,
        socialProviders: ["github"],
      },
    });
  });

  it("sets a step-up proof after valid TOTP", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: true,
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.hasVerifiedTotpForUser.mockReturnValue(true);
    mocks.verifyTOTP.mockResolvedValue({ ok: true });
    const { verifySecretRevealTotpActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(
      verifySecretRevealTotpActionImpl({ code: "123456" }),
    ).resolves.toEqual({ success: true });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "diagnostic_secret_reveal_verified",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 300 }),
    );
  });

  it("sets a social login intent when starting social step-up", async () => {
    mocks.access.mockResolvedValue({
      authenticationMethod: "Basic",
      canAccessRestrictedPages: true,
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.getLinkedSocialProvidersForUser.mockReturnValue(["github"]);
    const { beginSecretRevealStepUpActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(
      beginSecretRevealStepUpActionImpl({
        method: "social",
        provider: "github",
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "diagnostic_secret_reveal_pending",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 300 }),
    );
    expect(mocks.buildSocialLoginIntentValue).toHaveBeenCalledWith("github");
    expect(mocks.setSocialLoginIntentCookie).toHaveBeenCalledWith(
      "intent.value",
    );
  });

  it("returns an error when MAIL_PASSWORD is not configured", async () => {
    delete process.env.MAIL_PASSWORD;
    mocks.access.mockResolvedValue({
      authenticationMethod: "External",
      canAccessRestrictedPages: true,
    });
    const { revealMailPasswordActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(revealMailPasswordActionImpl()).resolves.toEqual({
      success: false,
      errorKey: "error_mail_password_not_set",
    });
  });

  it("returns an error when APPRISE_URL is not configured", async () => {
    delete process.env.APPRISE_URL;
    mocks.access.mockResolvedValue({
      authenticationMethod: "External",
      canAccessRestrictedPages: true,
    });
    const { revealAppriseUrlActionImpl } = await import(
      "@/lib/diagnostics/notification-config"
    );

    await expect(revealAppriseUrlActionImpl()).resolves.toEqual({
      success: false,
      errorKey: "error_apprise_url_not_set",
    });
  });
});

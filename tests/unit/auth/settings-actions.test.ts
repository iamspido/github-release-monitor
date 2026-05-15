const revalidatePathMock = vi.fn();
const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasCredentialPasswordAccountMock = vi.fn(() => false);
const isAuthEmailVerificationEnabledMock = vi.fn(() => false);
const getSessionMock = vi.fn(async () => ({
  user: { id: "user-1", email: null },
  session: { id: "session-1" },
}));
const setPasswordMock = vi.fn(async () => ({ ok: true, status: 200 }));
const changePasswordMock = vi.fn(async () => ({ ok: true, status: 200 }));
const changeEmailMock = vi.fn(async () => ({ ok: true, status: 200 }));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.99" }),
}));

vi.mock("@/lib/auth", () => ({
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  hasCredentialPasswordAccount: hasCredentialPasswordAccountMock,
  isAuthEmailVerificationEnabled: isAuthEmailVerificationEnabledMock,
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      setPassword: (...args: unknown[]) => setPasswordMock(...args),
      changePassword: (...args: unknown[]) => changePasswordMock(...args),
      changeEmail: (...args: unknown[]) => changeEmailMock(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      withScope: vi.fn(),
    }),
  },
}));

describe("auth settings actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    hasCredentialPasswordAccountMock.mockReturnValue(false);
    isAuthEmailVerificationEnabledMock.mockReturnValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", email: null },
      session: { id: "session-1" },
    });
    setPasswordMock.mockResolvedValue({ ok: true, status: 200 });
    changePasswordMock.mockResolvedValue({ ok: true, status: 200 });
    changeEmailMock.mockResolvedValue({ ok: true, status: 200 });
  });

  it("sets password when no credential password account exists", async () => {
    hasCredentialPasswordAccountMock.mockReturnValue(false);
    const { updateAccountPasswordAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountPasswordAction({
      newPassword: "VerySecurePass123",
    });

    expect(result).toEqual({ ok: true, mode: "set" });
    expect(setPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          newPassword: "VerySecurePass123",
        }),
      }),
    );
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("requires current password when credential account exists", async () => {
    hasCredentialPasswordAccountMock.mockReturnValue(true);
    const { updateAccountPasswordAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountPasswordAction({
      newPassword: "VerySecurePass123",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_password_current_required",
    });
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("rejects password updates that do not meet policy requirements", async () => {
    const { updateAccountPasswordAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountPasswordAction({
      newPassword: "lowercaseonly12",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_password_policy_invalid",
    });
    expect(setPasswordMock).not.toHaveBeenCalled();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("changes password when current password is provided", async () => {
    hasCredentialPasswordAccountMock.mockReturnValue(true);
    const { updateAccountPasswordAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountPasswordAction({
      currentPassword: "current-password",
      newPassword: "VerySecurePass123",
    });

    expect(result).toEqual({ ok: true, mode: "changed" });
    expect(changePasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          currentPassword: "current-password",
          newPassword: "VerySecurePass123",
          revokeOtherSessions: true,
        }),
      }),
    );
  });

  it("returns unauthenticated for missing session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "admin@example.com",
      callbackURL: "/de/settings",
    });

    expect(result).toEqual({ ok: false, errorKey: "account_auth_required" });
    expect(changeEmailMock).not.toHaveBeenCalled();
  });

  it("normalizes email and callback path for email change", async () => {
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: " Admin@Example.com ",
      callbackURL: "https://evil.example/phish",
    });

    expect(result).toEqual({ ok: true, mode: "updated" });
    expect(changeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          newEmail: "admin@example.com",
          callbackURL: "/",
        },
      }),
    );
  });

  it("treats unchanged email as success without calling Better Auth changeEmail", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1", email: "Admin@example.com" },
      session: { id: "session-1" },
    });
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "admin@example.com",
      callbackURL: "/settings",
    });

    expect(result).toEqual({ ok: true, mode: "updated" });
    expect(changeEmailMock).not.toHaveBeenCalled();
  });

  it("returns already in use when Better Auth reports duplicate email", async () => {
    changeEmailMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "email_already_exists", message: "already used" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "taken@example.com",
      callbackURL: "/settings",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_email_already_in_use",
    });
  });

  it("does not bypass Better Auth when changeEmail fails for non-duplicate reasons", async () => {
    changeEmailMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "email_change_requires_verification",
          message: "verification required",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "new@example.com",
      callbackURL: "/settings",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_email_update_failed",
    });
  });

  it("returns verification_sent when SMTP-based email verification flow is enabled", async () => {
    isAuthEmailVerificationEnabledMock.mockReturnValueOnce(true);
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "new@example.com",
      callbackURL: "/settings",
    });

    expect(result).toEqual({ ok: true, mode: "verification_sent" });
  });

  it("does not use direct fallback when verification flow is enabled and changeEmail fails", async () => {
    isAuthEmailVerificationEnabledMock.mockReturnValueOnce(true);
    changeEmailMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "email_change_failed" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "new@example.com",
      callbackURL: "/settings",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_email_update_failed",
    });
  });
});

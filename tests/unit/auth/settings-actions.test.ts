const revalidatePathMock = vi.fn();
const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasCredentialPasswordAccountMock = vi.fn(() => false);
const getLinkedSocialProvidersForUserMock = vi.fn(() => ["github"]);
const hasPasskeyForUserMock = vi.fn(() => false);
const canUnlinkAccountForUserMock = vi.fn<
  (_userId: string, _accountId: string) => boolean
>(() => false);
const getSocialProviderAccountIdForUserMock = vi.fn(
  (_userId: string, provider: "github" | "google") => `${provider}-account`,
);
const isAuthEmailVerificationEnabledMock = vi.fn(() => false);
const beginAuthEmailDeliveryTrackingMock = vi.fn(() => "delivery-1");
const consumeAuthEmailDeliveryStatusMock = vi.fn<
  (_trackingId: string) => "pending" | "sent" | "failed" | null
>(() => "pending");
type AuthSession = {
  user: { id: string; email: string | null };
  session: { id: string };
} | null;
const getSessionMock = vi.fn<() => Promise<AuthSession>>(async () => ({
  user: { id: "user-1", email: null },
  session: { id: "session-1" },
}));
const setPasswordMock = vi.fn(async () => ({ ok: true, status: 200 }));
const changePasswordMock = vi.fn(async () => ({ ok: true, status: 200 }));
type ChangeEmailInput = {
  headers: Headers;
  body: { newEmail: string; callbackURL: string };
  asResponse: true;
};
const changeEmailMock = vi.fn<
  (input: ChangeEmailInput) => Promise<{ ok: boolean; status: number }>
>(async () => ({ ok: true, status: 200 }));
type UnlinkAccountInput = { body: { accountId: string } };
const unlinkAccountMock = vi.fn<
  (input: UnlinkAccountInput) => Promise<{ ok: boolean; status: number }>
>(async () => ({ ok: true, status: 200 }));
const authLoggerErrorMock = vi.fn();
const authLoggerInfoMock = vi.fn();
const authLoggerWarnMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.99" }),
}));

vi.mock("@/lib/auth/email-delivery-status", () => ({
  AUTH_EMAIL_DELIVERY_TRACKING_HEADER: "x-grm-auth-email-delivery-id",
  beginAuthEmailDeliveryTracking: beginAuthEmailDeliveryTrackingMock,
  consumeAuthEmailDeliveryStatus: consumeAuthEmailDeliveryStatusMock,
}));

vi.mock("@/lib/auth", () => ({
  canUnlinkAccountForUser: canUnlinkAccountForUserMock,
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  getLinkedSocialProvidersForUser: getLinkedSocialProvidersForUserMock,
  getSocialProviderAccountIdForUser: getSocialProviderAccountIdForUserMock,
  hasCredentialPasswordAccount: hasCredentialPasswordAccountMock,
  hasPasskeyForUser: hasPasskeyForUserMock,
  isAuthEmailVerificationEnabled: isAuthEmailVerificationEnabledMock,
  auth: {
    api: {
      getSession: getSessionMock,
      setPassword: setPasswordMock,
      changePassword: changePasswordMock,
      changeEmail: changeEmailMock,
      unlinkAccount: unlinkAccountMock,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      error: authLoggerErrorMock,
      warn: authLoggerWarnMock,
      info: authLoggerInfoMock,
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
    getLinkedSocialProvidersForUserMock.mockReturnValue(["github"]);
    hasPasskeyForUserMock.mockReturnValue(false);
    canUnlinkAccountForUserMock.mockReturnValue(false);
    getSocialProviderAccountIdForUserMock.mockImplementation(
      (_userId, provider) => `${provider}-account`,
    );
    isAuthEmailVerificationEnabledMock.mockReturnValue(false);
    beginAuthEmailDeliveryTrackingMock.mockReturnValue("delivery-1");
    consumeAuthEmailDeliveryStatusMock.mockReturnValue("pending");
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", email: null },
      session: { id: "session-1" },
    });
    setPasswordMock.mockResolvedValue({ ok: true, status: 200 });
    changePasswordMock.mockResolvedValue({ ok: true, status: 200 });
    changeEmailMock.mockResolvedValue({ ok: true, status: 200 });
    unlinkAccountMock.mockResolvedValue({ ok: true, status: 200 });
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

  it.each([" VerySecurePass123 ", "Very SecurePass123"])(
    "rejects password updates containing whitespace: %j",
    async (newPassword) => {
      const { updateAccountPasswordAction } = await import(
        "@/app/auth/settings-actions"
      );

      const result = await updateAccountPasswordAction({
        newPassword,
      });

      expect(result).toEqual({
        ok: false,
        errorKey: "account_password_policy_invalid",
      });
      expect(setPasswordMock).not.toHaveBeenCalled();
      expect(changePasswordMock).not.toHaveBeenCalled();
    },
  );

  it("passes an existing password through unchanged when changing it", async () => {
    hasCredentialPasswordAccountMock.mockReturnValue(true);
    const { updateAccountPasswordAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountPasswordAction({
      currentPassword: " current-password ",
      newPassword: "VerySecurePass123",
    });

    expect(result).toEqual({ ok: true, mode: "changed" });
    expect(changePasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          currentPassword: " current-password ",
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
      newEmail: "admin@example.test",
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
      newEmail: " Admin@Example.test ",
      callbackURL: "https://evil.test/phish",
    });

    expect(result).toEqual({ ok: true, mode: "updated" });
    expect(changeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          newEmail: "admin@example.test",
          callbackURL: "/",
        },
      }),
    );
  });

  it("treats unchanged email as success without calling Better Auth changeEmail", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1", email: "Admin@example.test" },
      session: { id: "session-1" },
    });
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "admin@example.test",
      callbackURL: "/settings",
    });

    expect(result).toEqual({ ok: true, mode: "updated" });
    expect(changeEmailMock).not.toHaveBeenCalled();
  });

  it("returns already in use when Better Auth reports duplicate email", async () => {
    changeEmailMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "email_already_exists",
          message: "already used",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "taken@example.test",
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
      newEmail: "new@example.test",
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
      newEmail: "new@example.test",
      callbackURL: "/settings",
    });

    expect(result).toEqual({ ok: true, mode: "verification_sent" });
    expect(changeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          get: expect.any(Function),
        }),
      }),
    );
    const trackedHeaders = changeEmailMock.mock.calls[0]?.[0]
      .headers as Headers;
    expect(trackedHeaders.get("x-grm-auth-email-delivery-id")).toBe(
      "delivery-1",
    );
    expect(consumeAuthEmailDeliveryStatusMock).toHaveBeenCalledWith(
      "delivery-1",
    );
  });

  it("reports verification email delivery failures returned through the callback tracker", async () => {
    isAuthEmailVerificationEnabledMock.mockReturnValueOnce(true);
    consumeAuthEmailDeliveryStatusMock.mockReturnValueOnce("failed");
    const { updateAccountEmailAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await updateAccountEmailAction({
      newEmail: "new@example.test",
      callbackURL: "/settings",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_email_update_failed",
    });
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
      newEmail: "new@example.test",
      callbackURL: "/settings",
    });

    expect(result).toEqual({
      ok: false,
      errorKey: "account_email_update_failed",
    });
  });

  it("refuses to unlink the last available login method", async () => {
    const { unlinkSocialAccountAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await unlinkSocialAccountAction("github");

    expect(result).toEqual({
      ok: false,
      errorKey: "social_accounts_unlink_error",
    });
    expect(unlinkAccountMock).not.toHaveBeenCalled();
  });

  it("unlinks a social account when another login method remains", async () => {
    canUnlinkAccountForUserMock.mockReturnValue(true);
    const { unlinkSocialAccountAction } = await import(
      "@/app/auth/settings-actions"
    );

    const result = await unlinkSocialAccountAction("github");

    expect(result).toEqual({ ok: true });
    expect(unlinkAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { accountId: "github-account" },
        asResponse: true,
      }),
    );
  });

  it("logs a rejected unlink and explains when the session is not fresh", async () => {
    canUnlinkAccountForUserMock.mockReturnValue(true);
    unlinkAccountMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SESSION_NOT_FRESH",
          message: "Session is not fresh",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const { unlinkSocialAccountAction } = await import(
      "@/app/auth/settings-actions"
    );

    await expect(unlinkSocialAccountAction("github")).resolves.toEqual({
      ok: false,
      errorKey: "social_accounts_unlink_session_not_fresh",
    });
    expect(authLoggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "provider='github' for user='user-1' with status=403",
      ),
    );
  });

  it("serializes concurrent unlinks so one login method remains", async () => {
    let linkedProviders = ["github", "google"];
    let finishFirstUnlink: (() => void) | undefined;
    getLinkedSocialProvidersForUserMock.mockImplementation(() => [
      ...linkedProviders,
    ]);
    canUnlinkAccountForUserMock.mockImplementation(
      (_userId, accountId) =>
        linkedProviders.some(
          (provider) => `${provider}-account` === accountId,
        ) && linkedProviders.length > 1,
    );
    unlinkAccountMock.mockImplementationOnce(
      ({ body }: UnlinkAccountInput) =>
        new Promise((resolve) => {
          finishFirstUnlink = () => {
            linkedProviders = linkedProviders.filter(
              (provider) => `${provider}-account` !== body.accountId,
            );
            resolve({ ok: true, status: 200 });
          };
        }),
    );

    const { unlinkSocialAccountAction } = await import(
      "@/app/auth/settings-actions"
    );
    const githubUnlink = unlinkSocialAccountAction("github");
    const googleUnlink = unlinkSocialAccountAction("google");

    await vi.waitFor(() => {
      expect(unlinkAccountMock).toHaveBeenCalledOnce();
    });
    finishFirstUnlink?.();

    const results = await Promise.all([githubUnlink, googleUnlink]);
    expect(results).toContainEqual({ ok: true });
    expect(results).toContainEqual({
      ok: false,
      errorKey: "social_accounts_unlink_error",
    });
    expect(unlinkAccountMock).toHaveBeenCalledOnce();
    expect(linkedProviders).toHaveLength(1);
  });

  it("allows unlinking the final social account when a passkey remains", async () => {
    canUnlinkAccountForUserMock.mockReturnValue(true);
    const { unlinkSocialAccountAction } = await import(
      "@/app/auth/settings-actions"
    );

    await expect(unlinkSocialAccountAction("github")).resolves.toEqual({
      ok: true,
    });
    expect(unlinkAccountMock).toHaveBeenCalledOnce();
  });
});

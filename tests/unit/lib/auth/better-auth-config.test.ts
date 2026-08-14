const mocks = vi.hoisted(() => ({
  emailDeliveryEnabled: false,
  emailVerificationEnabled: false,
  featureConfig: {
    passkeyEnabled: false,
    signupEnabled: false,
    trustedSocialLinkingEnabled: false,
  },
  getAuthDb: vi.fn(() => ({ database: "auth-db" })),
  nextCookies: vi.fn((..._args: unknown[]) => ({ id: "next-cookies" })),
  passkey: vi.fn((..._args: unknown[]) => ({ id: "passkey" })),
  runTrackedDelivery: vi.fn(),
  secret: "a".repeat(32),
  sendCurrentEmailConfirmation: vi.fn(),
  sendNewEmailVerification: vi.fn(),
  sendPasswordReset: vi.fn(),
  trackBackgroundTask: vi.fn((task: Promise<unknown>) => task),
  twoFactor: vi.fn((..._args: unknown[]) => ({ id: "two-factor" })),
  username: vi.fn((..._args: unknown[]) => ({ id: "username" })),
}));

vi.mock("@better-auth/passkey", () => ({
  passkey: (...args: unknown[]) => mocks.passkey(...args),
}));

vi.mock("better-auth/next-js", () => ({
  nextCookies: (...args: unknown[]) => mocks.nextCookies(...args),
}));

vi.mock("better-auth/plugins", () => ({
  twoFactor: (...args: unknown[]) => mocks.twoFactor(...args),
  username: (...args: unknown[]) => mocks.username(...args),
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthFeatureConfig: () => mocks.featureConfig,
  getAuthSecret: () => mocks.secret,
}));

vi.mock("@/lib/auth/db", () => ({
  authDbPath: "/data/auth.db",
  getAuthDb: () => mocks.getAuthDb(),
}));

vi.mock("@/lib/auth/email-delivery-status", () => ({
  runTrackedAuthEmailDelivery: (...args: unknown[]) =>
    mocks.runTrackedDelivery(...args),
}));

vi.mock("@/lib/auth/mail", () => ({
  get authEmailDeliveryEnabled() {
    return mocks.emailDeliveryEnabled;
  },
  get authEmailVerificationEnabled() {
    return mocks.emailVerificationEnabled;
  },
  sendChangeEmailConfirmationToCurrentEmail: (...args: unknown[]) =>
    mocks.sendCurrentEmailConfirmation(...args),
  sendNewEmailVerificationEmail: (...args: unknown[]) =>
    mocks.sendNewEmailVerification(...args),
  sendPasswordResetEmail: (...args: unknown[]) =>
    mocks.sendPasswordReset(...args),
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

vi.mock("@/lib/secret-env", () => ({
  readSecretEnvValue: (value: string | undefined) => value?.trim(),
}));

vi.mock("@/lib/runtime/background-tasks", () => ({
  trackBackgroundTask: (task: Promise<unknown>) =>
    mocks.trackBackgroundTask(task),
}));

describe("auth/better-auth-config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.AUTH_GITHUB_CLIENT_ID;
    delete process.env.AUTH_GITHUB_CLIENT_SECRET;
    delete process.env.AUTH_GOOGLE_CLIENT_ID;
    delete process.env.AUTH_GOOGLE_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_BASE_URL;
    delete process.env.HTTPS;
    delete process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS;
    mocks.secret = "a".repeat(32);
    mocks.emailVerificationEnabled = false;
    mocks.emailDeliveryEnabled = false;
    mocks.featureConfig = {
      passkeyEnabled: false,
      signupEnabled: false,
      trustedSocialLinkingEnabled: false,
    };
    mocks.runTrackedDelivery.mockImplementation(
      async (_request: Request | undefined, send: () => Promise<void>) =>
        send(),
    );
    mocks.sendCurrentEmailConfirmation.mockResolvedValue(undefined);
    mocks.sendNewEmailVerification.mockResolvedValue(undefined);
    mocks.sendPasswordReset.mockResolvedValue(undefined);
    mocks.trackBackgroundTask.mockImplementation(
      (task: Promise<unknown>) => task,
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails fast when the Better Auth secret is insecure", async () => {
    mocks.secret = "too-short";

    await expect(import("@/lib/auth/better-auth-config")).rejects.toThrow(
      "Missing or insecure BETTER_AUTH_SECRET",
    );
    expect(mocks.getAuthDb).not.toHaveBeenCalled();
  });

  it("builds a secure minimal config with signup disabled", async () => {
    process.env.BETTER_AUTH_URL = "https://releases.example.test";
    const { getBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );

    const first = getBetterAuthConfig();
    const second = getBetterAuthConfig();

    expect(first).toBe(second);
    expect(first).toMatchObject({
      baseURL: "https://releases.example.test",
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
        resetPasswordTokenExpiresIn: 900,
        revokeSessionsOnPasswordReset: true,
      },
      rateLimit: {
        customRules: { "/request-password-reset": false },
      },
      advanced: {
        useSecureCookies: true,
        defaultCookieAttributes: {
          secure: true,
          httpOnly: true,
          sameSite: "lax",
        },
      },
      account: {
        accountLinking: {
          enabled: true,
          allowDifferentEmails: true,
          allowUnlinkingAll: true,
        },
      },
    });
    expect(first).not.toHaveProperty("socialProviders");
    expect(mocks.passkey).not.toHaveBeenCalled();
    expect(mocks.getAuthDb).toHaveBeenCalledOnce();
  });

  it("delivers reset emails with the configured expiry", async () => {
    mocks.emailDeliveryEnabled = true;
    process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS = "3600";
    const { getBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );
    const config = getBetterAuthConfig();

    expect(config.emailAndPassword.resetPasswordTokenExpiresIn).toBe(3600);
    await expect(
      config.emailAndPassword.sendResetPassword({
        user: { email: "admin@example.test" },
        url: "https://example.test/reset?token=secret",
        token: "secret",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendPasswordReset).toHaveBeenCalledWith({
      email: "admin@example.test",
      resetUrl: "https://example.test/reset?token=secret",
      expiresInSeconds: 3600,
    });
    expect(mocks.trackBackgroundTask).toHaveBeenCalledOnce();
  });

  it("keeps reset requests account-neutral when SMTP delivery fails", async () => {
    mocks.emailDeliveryEnabled = true;
    mocks.sendPasswordReset.mockRejectedValueOnce(
      new Error("SMTP unavailable"),
    );
    const { getBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );
    const config = getBetterAuthConfig();

    await expect(
      config.emailAndPassword.sendResetPassword({
        user: { email: "admin@example.test" },
        url: "https://example.test/reset?token=secret",
        token: "secret",
      }),
    ).resolves.toBeUndefined();
    await expect(
      mocks.trackBackgroundTask.mock.calls[0]?.[0],
    ).resolves.toBeUndefined();
  });

  it("returns before a pending reset email delivery completes", async () => {
    mocks.emailDeliveryEnabled = true;
    let finishDelivery: (() => void) | undefined;
    mocks.sendPasswordReset.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDelivery = resolve;
      }),
    );
    const { getBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );
    const config = getBetterAuthConfig();

    const callback = config.emailAndPassword.sendResetPassword({
      user: { email: "admin@example.test" },
      url: "https://example.test/reset?token=secret",
      token: "secret",
    });
    await expect(callback).resolves.toBeUndefined();
    expect(mocks.trackBackgroundTask).toHaveBeenCalledOnce();

    finishDelivery?.();
    await expect(
      mocks.trackBackgroundTask.mock.calls[0]?.[0],
    ).resolves.toBeUndefined();
  });

  it("enables passkeys, signup, and insecure development cookies explicitly", async () => {
    process.env.HTTPS = "false";
    mocks.featureConfig = {
      passkeyEnabled: true,
      signupEnabled: true,
      trustedSocialLinkingEnabled: false,
    };
    const { getBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );

    const config = getBetterAuthConfig();

    expect(config).toMatchObject({
      emailAndPassword: { disableSignUp: false },
      advanced: {
        useSecureCookies: false,
        defaultCookieAttributes: { secure: false },
      },
    });
    expect(mocks.passkey).toHaveBeenCalledOnce();
  });

  it("configures only complete social providers with distinct signup policies", async () => {
    process.env.AUTH_GITHUB_CLIENT_ID = " github-client ";
    process.env.AUTH_GITHUB_CLIENT_SECRET = " github-secret ";
    process.env.AUTH_GOOGLE_CLIENT_ID = "google-client";
    mocks.featureConfig = {
      passkeyEnabled: false,
      signupEnabled: false,
      trustedSocialLinkingEnabled: true,
    };
    const { getBetterAuthConfig, getSetupBetterAuthConfig } = await import(
      "@/lib/auth/better-auth-config"
    );

    const normalConfig = getBetterAuthConfig();
    const setupConfig = getSetupBetterAuthConfig();

    expect(normalConfig).toMatchObject({
      socialProviders: {
        github: {
          clientId: "github-client",
          clientSecret: "github-secret",
          disableImplicitSignUp: true,
        },
      },
      account: {
        accountLinking: { trustedProviders: ["github"] },
      },
    });
    expect(setupConfig).toMatchObject({
      emailAndPassword: { disableSignUp: false },
      socialProviders: {
        github: { disableImplicitSignUp: false },
      },
    });
    expect(normalConfig).not.toHaveProperty("socialProviders.google");
  });
});

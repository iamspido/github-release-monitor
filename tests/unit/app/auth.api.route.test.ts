const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasAnyAuthUserMock = vi.fn(() => "no_user");
const hasValidAuthSessionForRequestMock = vi.fn(() => false);
const ensureInitialAuthUserProfileMock = vi.fn(() => null);
const getAuthUserIdSnapshotMock = vi.fn(() => new Set(["existing-user"]));
const applySocialRegistrationProfileMock = vi.fn(() => "applied");
const isSignupEnabledMock = vi.fn(() => false);
const isAuthEmailDeliveryEnabledMock = vi.fn(() => false);
const consumePasswordResetRequestMock = vi.fn(
  (_clientIp: string, _identifier: string, _now?: number) => ({
    allowed: true,
    retryAfterSeconds: 0,
  }),
);
const readPasswordResetIdentifierFromRequestMock = vi.fn(
  async (_request: Request) => "admin@example.test",
);
const rewritePasswordResetIdentifierRequestMock = vi.fn(
  async (request: Request) => request,
);
const authLogMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
const canDeletePasskeyForUserMock = vi.fn<
  (_userId: string, _passkeyId: string) => boolean
>(() => false);
const canUnlinkAccountForUserMock = vi.fn<
  (_userId: string, _accountId: string) => boolean
>(() => false);
const getSessionMock = vi.fn(async () => ({
  user: { id: "user-1" },
  session: { id: "session-1" },
}));

const authInstance = { kind: "auth", api: { getSession: getSessionMock } };
const setupAuthInstance = { kind: "setup-auth" };
const authGetMock = vi.fn(async () => new Response(null, { status: 200 }));
const authPostMock = vi.fn(
  async (_request: Request) => new Response(null, { status: 200 }),
);
const setupGetMock = vi.fn(async () => new Response(null, { status: 200 }));
const setupPostMock = vi.fn(async () => new Response(null, { status: 200 }));

const toNextJsHandlerMock = vi.fn((instance: unknown) => {
  if (instance === setupAuthInstance) {
    return {
      GET: setupGetMock,
      POST: setupPostMock,
    };
  }
  return {
    GET: authGetMock,
    POST: authPostMock,
  };
});

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: toNextJsHandlerMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: authInstance,
  setupAuth: setupAuthInstance,
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  hasAnyAuthUser: hasAnyAuthUserMock,
  hasValidAuthSessionForRequest: hasValidAuthSessionForRequestMock,
  ensureInitialAuthUserProfile: ensureInitialAuthUserProfileMock,
  getAuthUserIdSnapshot: getAuthUserIdSnapshotMock,
  applySocialRegistrationProfile: applySocialRegistrationProfileMock,
  isSignupEnabled: isSignupEnabledMock,
  isAuthEmailDeliveryEnabled: isAuthEmailDeliveryEnabledMock,
  canDeletePasskeyForUser: canDeletePasskeyForUserMock,
  canUnlinkAccountForUser: canUnlinkAccountForUserMock,
}));

vi.mock("@/lib/auth/password-reset-rate-limit", () => ({
  consumePasswordResetRequest: (
    clientIp: string,
    identifier: string,
    now?: number,
  ) => consumePasswordResetRequestMock(clientIp, identifier, now),
}));

vi.mock("@/lib/auth/password-reset-identifier", () => ({
  readPasswordResetIdentifierFromRequest: (request: Request) =>
    readPasswordResetIdentifierFromRequestMock(request),
  rewritePasswordResetIdentifierRequest: (request: Request) =>
    rewritePasswordResetIdentifierRequestMock(request),
}));

type SetupSocialContext = {
  username: string;
  issuedAt: number;
  expiresAt: number;
} | null;
type SocialLoginIntent = {
  provider: string;
  purpose: string;
  username?: string;
  email?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
} | null;
const releaseAuthSetupBootstrapLockMock = vi.fn(async () => undefined);
type AuthSetupBootstrapLock =
  | { status: "acquired"; release: typeof releaseAuthSetupBootstrapLockMock }
  | { status: "busy"; release: typeof releaseAuthSetupBootstrapLockMock };

const isAuthSetupLockedMock = vi.fn(async () => false);
const writeAuthSetupLockMock = vi.fn(async () => "created");
const acquireAuthSetupBootstrapLockMock = vi.fn<
  (_options?: unknown) => Promise<AuthSetupBootstrapLock>
>(async () => ({
  status: "acquired" as const,
  release: releaseAuthSetupBootstrapLockMock,
}));

vi.mock("@/lib/auth/setup-lock", () => ({
  acquireAuthSetupBootstrapLock: acquireAuthSetupBootstrapLockMock,
  isAuthSetupLocked: isAuthSetupLockedMock,
  writeAuthSetupLock: writeAuthSetupLockMock,
}));

const readSetupSocialContextFromRequestMock = vi.fn<() => SetupSocialContext>(
  () => ({
    username: "admin",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  }),
);
const buildSetupSocialContextSetCookieHeaderMock = vi.fn(
  () => "auth_setup_social_context=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
);

vi.mock("@/lib/auth/setup-social-context", () => ({
  readSetupSocialContextFromRequest: readSetupSocialContextFromRequestMock,
  buildSetupSocialContextSetCookieHeader:
    buildSetupSocialContextSetCookieHeaderMock,
}));

const readSocialLoginIntentFromRequestMock = vi.fn<() => SocialLoginIntent>(
  () => null,
);
const buildSocialLoginIntentSetCookieHeaderMock = vi.fn(
  () => "auth_social_login_intent=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
);

vi.mock("@/lib/auth/social-login-intent", () => ({
  readSocialLoginIntentFromRequest: readSocialLoginIntentFromRequestMock,
  buildSocialLoginIntentSetCookieHeader:
    buildSocialLoginIntentSetCookieHeaderMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => authLogMocks,
  },
}));

describe("auth catch-all route setup social cookie handling", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...env,
      AUTH_SETUP_TOKEN: "x".repeat(64),
      BETTER_AUTH_SECRET: "y".repeat(64),
    };
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    hasAnyAuthUserMock.mockReturnValue("no_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(false);
    getAuthUserIdSnapshotMock.mockReturnValue(new Set(["existing-user"]));
    applySocialRegistrationProfileMock.mockReturnValue("applied");
    isSignupEnabledMock.mockReturnValue(false);
    isAuthEmailDeliveryEnabledMock.mockReturnValue(false);
    consumePasswordResetRequestMock.mockReturnValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    rewritePasswordResetIdentifierRequestMock.mockImplementation(
      async (request: Request) => request,
    );
    readPasswordResetIdentifierFromRequestMock.mockResolvedValue(
      "admin@example.test",
    );
    canDeletePasskeyForUserMock.mockReturnValue(false);
    canUnlinkAccountForUserMock.mockReturnValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    isAuthSetupLockedMock.mockResolvedValue(false);
    releaseAuthSetupBootstrapLockMock.mockResolvedValue(undefined);
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: "acquired",
      release: releaseAuthSetupBootstrapLockMock,
    });
    readSetupSocialContextFromRequestMock.mockReturnValue({
      username: "admin",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    readSocialLoginIntentFromRequestMock.mockReturnValue(null);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("does not create public reset tokens when SMTP is unavailable", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.test",
          redirectTo: "http://localhost/en/reset-password",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(authPostMock).not.toHaveBeenCalled();
    expect(rewritePasswordResetIdentifierRequestMock).not.toHaveBeenCalled();
  });

  it("rate limits password reset requests even when SMTP is unavailable", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    consumePasswordResetRequestMock.mockReturnValueOnce({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    await expect(response.json()).resolves.toEqual({
      error: "too_many_requests",
    });
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("applies the trusted client IP rate limit before SMTP reset delivery", async () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    isAuthEmailDeliveryEnabledMock.mockReturnValue(true);
    consumePasswordResetRequestMock.mockReturnValueOnce({
      allowed: false,
      retryAfterSeconds: 17,
    });
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({ email: "admin@example.test" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(consumePasswordResetRequestMock).toHaveBeenCalledWith(
      "203.0.113.7",
      "admin@example.test",
      undefined,
    );
    expect(rewritePasswordResetIdentifierRequestMock).not.toHaveBeenCalled();
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("does not trust forwarded addresses for reset limits by default", async () => {
    delete process.env.AUTH_TRUST_PROXY_HEADERS;
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    isAuthEmailDeliveryEnabledMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");

    await POST(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({ email: "admin@example.test" }),
      }),
    );

    expect(consumePasswordResetRequestMock).toHaveBeenCalledWith(
      "unknown",
      "admin@example.test",
      undefined,
    );
  });

  it("resolves a password reset username before invoking Better Auth", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    isAuthEmailDeliveryEnabledMock.mockReturnValue(true);
    rewritePasswordResetIdentifierRequestMock.mockImplementationOnce(
      async (request: Request) => {
        const payload = (await request.clone().json()) as Record<
          string,
          unknown
        >;
        return new Request(request, {
          body: JSON.stringify({
            ...payload,
            email: "admin@example.test",
          }),
        });
      },
    );
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin",
          redirectTo: "/en/reset-password",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(consumePasswordResetRequestMock).toHaveBeenCalledOnce();
    expect(rewritePasswordResetIdentifierRequestMock).toHaveBeenCalledOnce();
    expect(authPostMock).toHaveBeenCalledOnce();
    const forwardedRequest = authPostMock.mock.calls[0]?.[0] as Request;
    await expect(forwardedRequest.clone().json()).resolves.toEqual({
      email: "admin@example.test",
      redirectTo: "/en/reset-password",
    });
  });

  it("redacts reset callback tokens from success and error logs", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const secretToken = "secret-reset-token";

    await GET(
      new Request(
        `http://localhost/api/auth/reset-password/${secretToken}?callbackURL=%2Fen%2Freset-password`,
      ),
    );
    authGetMock.mockRejectedValueOnce(
      new Error(`Callback failed for ${secretToken}`),
    );
    await expect(
      GET(
        new Request(
          `http://localhost/api/auth/reset-password/${secretToken}?callbackURL=%2Fen%2Freset-password`,
        ),
      ),
    ).rejects.toThrow("Callback failed");

    const logged = Object.values(authLogMocks)
      .flatMap((mock) => mock.mock.calls.flat())
      .map(String)
      .join(" ");
    expect(logged).toContain("reset-password/[redacted]");
    expect(logged).not.toContain(secretToken);
  });

  it("does not log reset tokens retained by POST error objects", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const secretToken = "post-secret-reset-token";
    authPostMock.mockRejectedValueOnce(
      new Error(`Failed request body contained token ${secretToken}`),
    );

    await expect(
      POST(
        new Request("http://localhost/api/auth/reset-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            newPassword: "StrongPassword1",
            token: secretToken,
          }),
        }),
      ),
    ).rejects.toThrow("Failed request body");

    const logged = Object.values(authLogMocks)
      .flatMap((mock) => mock.mock.calls.flat())
      .map(String)
      .join(" ");
    expect(logged).toContain("/api/auth/reset-password");
    expect(logged).not.toContain(secretToken);
  });

  it("rejects unlinking the last login method through the direct auth route", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/unlink-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "github-account" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("allows a direct unlink when another login method remains", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    canUnlinkAccountForUserMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/unlink-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "github-account" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(canUnlinkAccountForUserMock).toHaveBeenCalledWith(
      "user-1",
      "github-account",
    );
    expect(authPostMock).toHaveBeenCalledOnce();
  });

  it("preserves the local account selection for direct unlink requests", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    canUnlinkAccountForUserMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/unlink-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "account-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(canUnlinkAccountForUserMock).toHaveBeenCalledWith(
      "user-1",
      "account-1",
    );
    expect(authPostMock).toHaveBeenCalledOnce();
  });

  it("rejects deleting the final passkey through the direct auth route", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "passkey-1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "passkeys_error_delete",
    });
    expect(canDeletePasskeyForUserMock).toHaveBeenCalledWith(
      "user-1",
      "passkey-1",
    );
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("returns the passkey deletion error contract for an invalid direct request", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "passkeys_error_delete",
    });
    expect(canDeletePasskeyForUserMock).not.toHaveBeenCalled();
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("allows deleting a passkey when another login method remains", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    canDeletePasskeyForUserMock.mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "passkey-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(authPostMock).toHaveBeenCalledOnce();
  });

  it("does not clear setup context cookie on sign-in/social request", async () => {
    setupPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/login/oauth/authorize" },
      }),
    );
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(302);
    expect(setupPostMock).toHaveBeenCalledTimes(1);
    expect(buildSetupSocialContextSetCookieHeaderMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears setup context cookie on callback request", async () => {
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/de/login" },
      }),
    );
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(302);
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(acquireAuthSetupBootstrapLockMock).toHaveBeenCalledWith({
      source: "/api/auth/callback/github",
    });
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(buildSetupSocialContextSetCookieHeaderMock).toHaveBeenCalledWith(
      null,
    );
    expect(response.headers.get("set-cookie")).toContain(
      "auth_setup_social_context=",
    );
  });

  it("blocks social sign-in without valid intent when signup is disabled", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(authPostMock).not.toHaveBeenCalled();
    expect(setupPostMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("allows social sign-in with valid intent when signup is disabled", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: "github",
      purpose: "login",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "nonce",
    });
    authPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/login/oauth/authorize" },
      }),
    );
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      }),
    );

    expect(response.status).toBe(302);
    expect(authPostMock).toHaveBeenCalledTimes(1);
    expect(setupPostMock).not.toHaveBeenCalled();
  });

  it("routes an explicit social registration intent through the user-creation handler", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: "github",
      purpose: "register",
      username: "AdminUser",
      email: "admin@example.test",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "nonce",
    });
    setupPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/login/oauth/authorize" },
      }),
    );

    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      }),
    );

    expect(response.status).toBe(302);
    expect(setupPostMock).toHaveBeenCalledTimes(1);
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("blocks social sign-in without valid intent even when signup is enabled", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    isSignupEnabledMock.mockReturnValue(true);

    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(authPostMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("allows authenticated social linking flow without social precheck intent", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    authPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/login/oauth/authorize" },
      }),
    );

    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      }),
    );

    expect(response.status).toBe(302);
    expect(authPostMock).toHaveBeenCalledTimes(1);
  });

  it("does not block social callback without precheck intent", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(false);
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://localhost/en/login?error=signup_disabled",
        },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(302);
    expect(authGetMock).toHaveBeenCalledTimes(1);
    expect(setupGetMock).not.toHaveBeenCalled();
  });

  it("marks diagnostic social step-up verified on successful provider callback", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const {
      createSecretRevealStepUpPayload,
      encodeSecretRevealStepUpCookieValue,
    } = await import("@/lib/diagnostics/secret-reveal-step-up");
    const pendingCookieValue = encodeSecretRevealStepUpCookieValue(
      createSecretRevealStepUpPayload({
        userId: "user-1",
        method: "social",
        provider: "github",
      }),
    );
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/test?secretRevealStepUp=1" },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
        headers: {
          cookie: `diagnostic_secret_reveal_pending=${pendingCookieValue}`,
        },
      }),
    );

    expect(response.status).toBe(302);
    expect(authGetMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain(
      "diagnostic_secret_reveal_pending=",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "diagnostic_secret_reveal_verified=",
    );
  });

  it("does not verify diagnostic social step-up when provider callback carries an OAuth error", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const {
      createSecretRevealStepUpPayload,
      encodeSecretRevealStepUpCookieValue,
    } = await import("@/lib/diagnostics/secret-reveal-step-up");
    const pendingCookieValue = encodeSecretRevealStepUpCookieValue(
      createSecretRevealStepUpPayload({
        userId: "user-1",
        method: "social",
        provider: "github",
      }),
    );
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://localhost/test?secretRevealStepUp=1",
        },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request(
        "http://localhost/api/auth/callback/github?error=access_denied",
        {
          method: "GET",
          headers: {
            cookie: `diagnostic_secret_reveal_pending=${pendingCookieValue}`,
          },
        },
      ),
    );

    expect(response.status).toBe(302);
    expect(authGetMock).toHaveBeenCalledTimes(1);
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).not.toContain(
      "diagnostic_secret_reveal_verified=",
    );
  });

  it("does not verify diagnostic social step-up when auth handler redirects with an OAuth error", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const {
      createSecretRevealStepUpPayload,
      encodeSecretRevealStepUpCookieValue,
    } = await import("@/lib/diagnostics/secret-reveal-step-up");
    const pendingCookieValue = encodeSecretRevealStepUpCookieValue(
      createSecretRevealStepUpPayload({
        userId: "user-1",
        method: "social",
        provider: "github",
      }),
    );
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://localhost/en/login?error=signup_disabled",
        },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
        headers: {
          cookie: `diagnostic_secret_reveal_pending=${pendingCookieValue}`,
        },
      }),
    );

    expect(response.status).toBe(302);
    expect(authGetMock).toHaveBeenCalledTimes(1);
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).not.toContain(
      "diagnostic_secret_reveal_verified=",
    );
  });

  it("blocks setup social callback when another setup bootstrap is in progress", async () => {
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: "busy",
      release: releaseAuthSetupBootstrapLockMock,
    });

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "setup_in_progress",
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "auth_setup_social_context=",
    );
    expect(releaseAuthSetupBootstrapLockMock).not.toHaveBeenCalled();
  });

  it("fails closed for setup social flow when auth user existence cannot be determined", async () => {
    hasAnyAuthUserMock.mockReturnValue("unknown");

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "auth_setup_social_context=",
    );
  });

  it("fails closed for setup social callback when user recheck after lock is unknown", async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce("no_user")
      .mockReturnValueOnce("unknown");

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain(
      "auth_setup_social_context=",
    );
  });

  it("fails closed after setup social callback when final user check is unknown", async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce("no_user")
      .mockReturnValueOnce("no_user")
      .mockReturnValueOnce("unknown");
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/de/login" },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(writeAuthSetupLockMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain(
      "auth_setup_social_context=",
    );
  });

  it("applies register social intent username to the newly created callback user", async () => {
    const snapshot = new Set(["existing-user"]);
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    getAuthUserIdSnapshotMock.mockReturnValue(snapshot);
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: "github",
      purpose: "register",
      username: "AdminUser",
      email: "admin@example.test",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "nonce",
    });
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/en" },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(302);
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(authGetMock).not.toHaveBeenCalled();
    expect(getAuthUserIdSnapshotMock).toHaveBeenCalledTimes(1);
    expect(applySocialRegistrationProfileMock).toHaveBeenCalledWith({
      previousUserIds: snapshot,
      username: "AdminUser",
      email: "admin@example.test",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("does not apply register social intent when callback provider differs", async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: "google",
      purpose: "register",
      username: "AdminUser",
      email: "admin@example.test",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "nonce",
    });
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/en" },
      }),
    );

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const response = await GET(
      new Request("http://localhost/api/auth/callback/github", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(302);
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(authGetMock).not.toHaveBeenCalled();
    expect(getAuthUserIdSnapshotMock).not.toHaveBeenCalled();
    expect(applySocialRegistrationProfileMock).not.toHaveBeenCalled();
  });
});

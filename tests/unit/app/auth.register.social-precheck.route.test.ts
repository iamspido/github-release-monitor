const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const isSignupEnabledMock = vi.fn(() => true);
const isSocialProviderConfiguredMock = vi.fn(() => true);
const findRegistrationConflictMock = vi.fn(() => "none");
const buildSocialLoginIntentValueMock = vi.fn(() => "intent.value");
const buildSocialLoginIntentSetCookieHeaderMock = vi.fn(
  () => "auth_social_login_intent=intent.value; Path=/; HttpOnly; SameSite=Lax; Max-Age=120",
);

vi.mock("@/lib/auth", () => ({
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  isSignupEnabled: isSignupEnabledMock,
  isSocialProviderConfigured: isSocialProviderConfiguredMock,
  findRegistrationConflict: findRegistrationConflictMock,
}));

vi.mock("@/lib/auth-social-login-intent", () => ({
  buildSocialLoginIntentValue: buildSocialLoginIntentValueMock,
  buildSocialLoginIntentSetCookieHeader: buildSocialLoginIntentSetCookieHeaderMock,
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

function setupRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/register/social-precheck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("auth register social-precheck route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    isSignupEnabledMock.mockReturnValue(true);
    isSocialProviderConfiguredMock.mockReturnValue(true);
    findRegistrationConflictMock.mockReturnValue("none");
  });

  it("allows social registration when no conflicts exist", async () => {
    const { POST } = await import("@/app/api/auth/register/social-precheck/route");
    const response = await POST(
      setupRequest({
        provider: "github",
        username: "admin",
        email: "admin@example.com",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ canProceed: true });
    expect(buildSocialLoginIntentValueMock).toHaveBeenCalledWith("github", {
      purpose: "register",
      username: "admin",
      email: "admin@example.com",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("denies social registration on duplicate username", async () => {
    findRegistrationConflictMock.mockReturnValue("username_in_use");
    const { POST } = await import("@/app/api/auth/register/social-precheck/route");
    const response = await POST(
      setupRequest({
        provider: "github",
        username: "admin",
        email: "admin@example.com",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      canProceed: false,
      error: "username_in_use",
    });
  });

  it("rejects invalid username", async () => {
    const { POST } = await import("@/app/api/auth/register/social-precheck/route");
    const response = await POST(
      setupRequest({
        provider: "github",
        username: "a",
        email: "admin@example.com",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_username",
    });
  });

  it("rejects usernames outside the Better Auth default policy", async () => {
    const { POST } = await import("@/app/api/auth/register/social-precheck/route");
    const response = await POST(
      setupRequest({
        provider: "github",
        username: "admin-user",
        email: "admin@example.com",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_username",
    });
  });

  it("rejects requests when signup is disabled", async () => {
    isSignupEnabledMock.mockReturnValue(false);
    const { POST } = await import("@/app/api/auth/register/social-precheck/route");
    const response = await POST(
      setupRequest({
        provider: "github",
        username: "admin",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "signup_disabled",
    });
  });
});

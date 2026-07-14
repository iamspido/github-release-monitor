const isSocialProviderConfiguredMock = vi.fn(() => true);

vi.mock("@/lib/auth", () => ({
  isSocialProviderConfigured: isSocialProviderConfiguredMock,
}));

const buildSocialLoginIntentValueMock = vi.fn(() => "intent.value");
const buildSocialLoginIntentSetCookieHeaderMock = vi.fn(
  () =>
    "auth_social_login_intent=intent.value; Path=/; HttpOnly; SameSite=Lax; Max-Age=120",
);

vi.mock("@/lib/auth/social-login-intent", () => ({
  buildSocialLoginIntentValue: buildSocialLoginIntentValueMock,
  buildSocialLoginIntentSetCookieHeader:
    buildSocialLoginIntentSetCookieHeaderMock,
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

function precheckRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/social/precheck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("auth social precheck route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    isSocialProviderConfiguredMock.mockReturnValue(true);
  });

  it("still requires precheck even when signup is enabled", async () => {
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({
        identifier: "admin",
        provider: "github",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ canProceed: true });
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("returns canProceed=true and sets intent cookie for linked account", async () => {
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({
        identifier: "admin",
        provider: "github",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ canProceed: true });
    expect(buildSocialLoginIntentValueMock).toHaveBeenCalledWith("github");
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("does not disclose whether an account is linked", async () => {
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({
        identifier: "admin",
        provider: "github",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ canProceed: true });
    expect(response.headers.get("set-cookie")).toContain(
      "auth_social_login_intent=",
    );
  });

  it("rejects missing identifier", async () => {
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({
        identifier: "",
        provider: "github",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
  });

  it("rejects a provider that is not configured", async () => {
    isSocialProviderConfiguredMock.mockReturnValue(false);
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({ identifier: "admin", provider: "github" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "provider_not_configured",
    });
  });

  it("rejects unsupported provider", async () => {
    const { POST } = await import("@/app/api/auth/social/precheck/route");
    const response = await POST(
      precheckRequest({
        identifier: "admin",
        provider: "gitlab",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_provider",
    });
  });
});

// vitest globals enabled

const mocks = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: mocks.signInSocial } },
}));

describe("social client flows", () => {
  beforeEach(() => {
    mocks.signInSocial.mockReset();
    mocks.fetch.mockReset();
    mocks.signInSocial.mockResolvedValue({});
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prechecks login before starting the provider", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ canProceed: true }), { status: 200 }),
    );
    const { startLoginSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startLoginSocialFlow({
        identifier: "release_user",
        provider: "github",
        callbackURL: "/de/settings",
      }),
    ).resolves.toEqual({ status: "started" });
    expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/de/settings",
    });
  });

  it("maps registration precheck errors without starting the provider", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "username_in_use" }), {
        status: 409,
      }),
    );
    const { startRegistrationSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startRegistrationSocialFlow({
        provider: "google",
        username: "release_user",
        email: "user@example.test",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_setup_username_in_use",
    });
    expect(mocks.signInSocial).not.toHaveBeenCalled();
  });

  it.each([
    ["", "error_social_identifier_required"],
    ["invalid-user", "error_social_identifier_invalid"],
  ])(
    "rejects invalid login identifier %j before the precheck",
    async (identifier, errorKey) => {
      const { startLoginSocialFlow } = await import(
        "@/lib/auth/client-social-flow"
      );

      await expect(
        startLoginSocialFlow({
          identifier,
          provider: "github",
        }),
      ).resolves.toEqual({ status: "error", errorKey });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.signInSocial).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      400,
      {},
      { status: "error", errorKey: "error_social_identifier_required" },
    ],
    [503, {}, { status: "error", errorKey: "error_social_login_failed" }],
    [200, { canProceed: false }, { status: "unavailable" }],
  ] as const)(
    "maps login social precheck status %s",
    async (status, body, expected) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify(body), { status }),
      );
      const { startLoginSocialFlow } = await import(
        "@/lib/auth/client-social-flow"
      );

      await expect(
        startLoginSocialFlow({
          identifier: "release_user",
          provider: "github",
        }),
      ).resolves.toEqual(expected);
      expect(mocks.signInSocial).not.toHaveBeenCalled();
    },
  );

  it("maps provider and precheck exceptions to a login error", async () => {
    const { startLoginSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));

    await expect(
      startLoginSocialFlow({
        identifier: "release_user",
        provider: "github",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_social_login_failed",
    });

    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ canProceed: true }), { status: 200 }),
    );
    mocks.signInSocial.mockResolvedValueOnce({ error: { message: "denied" } });

    await expect(
      startLoginSocialFlow({
        identifier: "release_user",
        provider: "github",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_social_login_failed",
    });
  });

  it("normalizes registration data before starting the provider", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ canProceed: true }), { status: 200 }),
    );
    const { startRegistrationSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startRegistrationSocialFlow({
        provider: "google",
        username: " release_user ",
        email: " USER@EXAMPLE.TEST ",
      }),
    ).resolves.toEqual({ status: "started" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/register/social-precheck",
      expect.objectContaining({
        body: JSON.stringify({
          provider: "google",
          username: "release_user",
          email: "user@example.test",
        }),
      }),
    );
    expect(mocks.signInSocial).toHaveBeenCalledWith({ provider: "google" });
  });

  it("rejects an invalid registration username before the API call", async () => {
    const { startRegistrationSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startRegistrationSocialFlow({
        provider: "google",
        username: "invalid-user",
        email: "user@example.test",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_setup_invalid_username",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [404, {}, { status: "unavailable" }],
    [401, {}, { status: "error", errorKey: "error_invalid_setup_token" }],
    [
      422,
      { error: "provider_not_configured" },
      { status: "error", errorKey: "error_setup_provider_not_configured" },
    ],
  ] as const)(
    "maps setup social context status %s",
    async (status, body, expected) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify(body), { status }),
      );
      const { startSetupSocialFlow } = await import(
        "@/lib/auth/client-social-flow"
      );

      await expect(
        startSetupSocialFlow({
          token: "setup-token",
          provider: "github",
          username: "release_user",
          name: "Release User",
        }),
      ).resolves.toEqual(expected);
      expect(mocks.signInSocial).not.toHaveBeenCalled();
    },
  );

  it("starts setup social auth with normalized context and callback", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { startSetupSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startSetupSocialFlow({
        token: "setup-token",
        provider: "github",
        username: " release_user ",
        name: " Release User ",
        callbackURL: "/settings",
      }),
    ).resolves.toEqual({ status: "started" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/setup/social-context",
      expect.objectContaining({
        body: JSON.stringify({
          token: "setup-token",
          provider: "github",
          username: "release_user",
          name: "Release User",
        }),
      }),
    );
    expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/settings",
    });
  });

  it("rejects invalid setup usernames and maps setup exceptions", async () => {
    const { startSetupSocialFlow } = await import(
      "@/lib/auth/client-social-flow"
    );

    await expect(
      startSetupSocialFlow({
        token: "setup-token",
        provider: "github",
        username: "invalid-user",
        name: "Release User",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_setup_invalid_username",
    });

    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(
      startSetupSocialFlow({
        token: "setup-token",
        provider: "github",
        username: "release_user",
        name: "Release User",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_setup_failed",
    });
  });
});

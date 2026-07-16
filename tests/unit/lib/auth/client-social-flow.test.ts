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
        email: "user@example.com",
      }),
    ).resolves.toEqual({
      status: "error",
      errorKey: "error_setup_username_in_use",
    });
    expect(mocks.signInSocial).not.toHaveBeenCalled();
  });
});

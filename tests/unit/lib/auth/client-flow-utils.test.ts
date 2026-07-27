import {
  checkSetupRequired,
  isSocialErrorKey,
  isValidSocialUsername,
  mapOauthErrorToMessageKey,
  mapRegisterSocialPrecheckErrorToMessageKey,
  mapSetupApiErrorToMessageKey,
  navigateToClientPath,
  normalizeApiErrorCode,
  normalizeLocalizedRedirectPath,
  normalizeOptionalSafeRelativePath,
  normalizeSafeRelativePath,
  precheckSocialLogin,
  readApiErrorCode,
  submitPasswordLogin,
  submitSetup,
  submitSetupSocialContext,
} from "@/lib/auth/client-flow-utils";

describe("auth/client-flow-utils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps OAuth callback errors to translation keys", () => {
    expect(mapOauthErrorToMessageKey(null)).toBeNull();
    expect(mapOauthErrorToMessageKey(" signup_disabled ")).toBe(
      "error_social_signup_disabled",
    );
    expect(mapOauthErrorToMessageKey("STATE_MISMATCH")).toBe(
      "error_social_state_mismatch",
    );
    expect(mapOauthErrorToMessageKey("unknown_code")).toBe(
      "error_social_login_failed",
    );
  });

  it("delegates client navigation to the provided location assigner", () => {
    const assign = vi.fn();

    navigateToClientPath("/en/settings", assign);

    expect(assign).toHaveBeenCalledWith("/en/settings");
  });

  it("recognizes social error translation keys", () => {
    expect(isSocialErrorKey("error_social_login_failed")).toBe(true);
    expect(isSocialErrorKey("error_invalid_credentials")).toBe(false);
    expect(isSocialErrorKey(null)).toBe(false);
  });

  it("validates usernames with the shared Better Auth username policy", () => {
    expect(isValidSocialUsername(" admin_user.1 ")).toBe(true);
    expect(isValidSocialUsername("ad")).toBe(false);
    expect(isValidSocialUsername("admin-user")).toBe(false);
  });

  it("normalizes safe relative paths", () => {
    expect(normalizeSafeRelativePath("/settings")).toBe("/settings");
    expect(normalizeSafeRelativePath("https://evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("//evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/../settings")).toBe("/");
    expect(normalizeSafeRelativePath("/\\\\evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/%2e%2e/settings")).toBe("/");
    expect(normalizeSafeRelativePath("/%2f%2fevil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/settings?q=1#section")).toBe(
      "/settings?q=1#section",
    );
    expect(normalizeOptionalSafeRelativePath("/settings")).toBe("/settings");
    expect(normalizeOptionalSafeRelativePath("https://evil.test")).toBe(
      undefined,
    );
  });

  it("normalizes localized redirects only for full locale path segments", () => {
    expect(normalizeLocalizedRedirectPath("/en/settings", "en")).toBe(
      "/settings",
    );
    expect(normalizeLocalizedRedirectPath("/en", "en")).toBe("/");
    expect(normalizeLocalizedRedirectPath("/en?from=login", "en")).toBe(
      "/?from=login",
    );
    expect(normalizeLocalizedRedirectPath("/en#section", "en")).toBe(
      "/#section",
    );
    expect(normalizeLocalizedRedirectPath("/enterprise", "en")).toBe(
      "/enterprise",
    );
    expect(normalizeLocalizedRedirectPath("/english/docs", "en")).toBe(
      "/english/docs",
    );
    expect(normalizeLocalizedRedirectPath("/de/settings", "en")).toBe(
      "/de/settings",
    );
    expect(normalizeLocalizedRedirectPath("https://evil.test", "en")).toBe("/");
  });

  it("normalizes API error code values", () => {
    expect(normalizeApiErrorCode(" INVALID_INPUT ")).toBe("invalid_input");
    expect(normalizeApiErrorCode(" ")).toBeNull();
    expect(normalizeApiErrorCode(401)).toBeNull();
  });

  it("reads normalized API error codes from error or code response fields", async () => {
    await expect(
      readApiErrorCode(
        new Response(JSON.stringify({ error: " INVALID_USERNAME " })),
      ),
    ).resolves.toBe("invalid_username");
    await expect(
      readApiErrorCode(new Response(JSON.stringify({ code: "EMAIL_IN_USE" }))),
    ).resolves.toBe("email_in_use");
    await expect(
      readApiErrorCode(new Response("not-json")),
    ).resolves.toBeNull();
  });

  it("maps setup API errors to setup translation keys", () => {
    expect(mapSetupApiErrorToMessageKey(null)).toBe("error_setup_failed");
    expect(mapSetupApiErrorToMessageKey("invalid_setup_token")).toBe(
      "error_invalid_setup_token",
    );
    expect(mapSetupApiErrorToMessageKey("provider_not_configured")).toBe(
      "error_setup_provider_not_configured",
    );
    expect(mapSetupApiErrorToMessageKey("unknown")).toBe("error_setup_failed");
  });

  it("maps register social precheck errors to register translation keys", () => {
    expect(mapRegisterSocialPrecheckErrorToMessageKey(null)).toBe(
      "error_social_login_failed",
    );
    expect(mapRegisterSocialPrecheckErrorToMessageKey("email_in_use")).toBe(
      "error_setup_email_in_use",
    );
    expect(
      mapRegisterSocialPrecheckErrorToMessageKey("provider_not_configured"),
    ).toBe("error_setup_provider_not_configured");
    expect(mapRegisterSocialPrecheckErrorToMessageKey("unknown")).toBe(
      "error_social_login_failed",
    );
  });

  it("checks whether initial setup is still required", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSetupRequired()).resolves.toBe(true);
    await expect(checkSetupRequired()).resolves.toBe(false);
    await expect(checkSetupRequired()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/setup", {
      method: "GET",
      cache: "no-store",
    });
  });

  it("submits password login data and returns successful API state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requiresTwoFactor: true,
          redirectTo: "/settings",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitPasswordLogin({
        identifier: "release_user",
        password: "SecretPassword123",
        next: "/settings",
        locale: "en",
      }),
    ).resolves.toEqual({
      requiresTwoFactor: true,
      redirectTo: "/settings",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/login/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "release_user",
        password: "SecretPassword123",
        next: "/settings",
        locale: "en",
      }),
    });
  });

  it("normalizes password login API and network failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorKey: "error_locked" }), {
          status: 429,
        }),
      )
      .mockResolvedValueOnce(new Response("not-json", { status: 401 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      identifier: "release_user",
      password: "wrong",
      locale: "en",
    } satisfies Parameters<typeof submitPasswordLogin>[0];
    await expect(submitPasswordLogin(input)).resolves.toEqual({
      errorKey: "error_locked",
    });
    await expect(submitPasswordLogin(input)).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(submitPasswordLogin(input)).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
  });

  it.each([
    [400, {}, "invalid_input"],
    [503, {}, "failed"],
    [200, { canProceed: false }, "unavailable"],
    [200, { canProceed: true }, "allowed"],
  ] as const)(
    "maps social login precheck status %s to %s",
    async (status, body, expected) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        precheckSocialLogin({
          identifier: "release_user",
          provider: "github",
        }),
      ).resolves.toBe(expected);
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/social/precheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: "release_user",
          provider: "github",
        }),
      });
    },
  );

  it.each([
    [404, {}, "unavailable"],
    [401, {}, "invalid_token"],
    [
      422,
      { error: "invalid_username" },
      { errorKey: "error_setup_invalid_username" },
    ],
    [200, {}, "success"],
  ] as const)(
    "maps setup response status %s",
    async (status, body, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status,
          }),
        ),
      );

      await expect(
        submitSetup({
          token: "setup-token",
          email: "user@example.test",
          password: "SecretPassword123",
          name: "Release User",
          username: "release_user",
        }),
      ).resolves.toEqual(expected);
    },
  );

  it.each([
    [404, {}, "unavailable"],
    [401, {}, "invalid_token"],
    [
      422,
      { code: "provider_not_configured" },
      { errorKey: "error_setup_provider_not_configured" },
    ],
    [200, {}, "success"],
  ] as const)(
    "maps social setup context response status %s",
    async (status, body, expected) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        submitSetupSocialContext({
          token: "setup-token",
          provider: "google",
          username: "release_user",
          name: "Release User",
        }),
      ).resolves.toEqual(expected);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/setup/social-context",
        expect.objectContaining({
          body: JSON.stringify({
            token: "setup-token",
            provider: "google",
            username: "release_user",
            name: "Release User",
          }),
        }),
      );
    },
  );
});

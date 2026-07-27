// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const signInEmailMock = vi.fn(async (): Promise<Response> => new Response());
const signInUsernameMock = vi.fn(async (): Promise<Response> => new Response());
const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const originalTrustProxyHeaders = process.env.AUTH_TRUST_PROXY_HEADERS;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signInEmail: signInEmailMock,
      signInUsername: signInUsernameMock,
    },
  },
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
}));

describe("api/login/password route", () => {
  beforeEach(() => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
    vi.resetModules();
    (globalThis as Record<string, unknown>)._failedLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginOverflowAttempts =
      undefined;
    signInEmailMock.mockReset();
    signInUsernameMock.mockReset();
    ensureAuthDatabaseReadyMock.mockReset();
    signInEmailMock.mockResolvedValue(new Response());
    signInUsernameMock.mockResolvedValue(new Response());
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.AUTH_TRUST_PROXY_HEADERS;
    } else {
      process.env.AUTH_TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    }
  });

  function buildRequest(body: Record<string, unknown>) {
    return new Request("https://example.test/api/login/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.23",
      },
      body: JSON.stringify(body),
    });
  }

  it("returns a localized redirect without stripping locale-looking path segments", async () => {
    const { POST } = await import("@/app/api/login/password/route");

    const response = await POST(
      buildRequest({
        identifier: "user@example.test",
        password: "pass",
        locale: "en",
        next: "/enterprise",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      redirectTo: "/en/enterprise",
    });
  });

  it("removes an existing locale path segment once", async () => {
    const { POST } = await import("@/app/api/login/password/route");

    const response = await POST(
      buildRequest({
        identifier: "user@example.test",
        password: "pass",
        locale: "en",
        next: "/en/settings",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      redirectTo: "/en/settings",
    });
  });

  it("rejects malformed JSON before attempting authentication", async () => {
    const { POST } = await import("@/app/api/login/password/route");
    const request = new Request("https://example.test/api/login/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    expect(ensureAuthDatabaseReadyMock).not.toHaveBeenCalled();
    expect(signInEmailMock).not.toHaveBeenCalled();
  });

  it("preserves the authentication error status and key", async () => {
    signInEmailMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { POST } = await import("@/app/api/login/password/route");

    const response = await POST(
      buildRequest({
        identifier: "user@example.test",
        password: "wrong",
        locale: "en",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
  });

  it.each([
    [" DE ", "/settings", "/de/settings"],
    ["unsupported", "https://evil.test", "/en/"],
    [42, undefined, "/en/"],
  ] as const)(
    "normalizes locale %j and the redirect path",
    async (locale, next, redirectTo) => {
      const { POST } = await import("@/app/api/login/password/route");

      const response = await POST(
        buildRequest({
          identifier: "user@example.test",
          password: "pass",
          locale,
          next,
        }),
      );

      await expect(response.json()).resolves.toEqual({ redirectTo });
    },
  );

  it.each([
    [false, { redirectTo: "/en/settings" }],
    [true, { requiresTwoFactor: true }],
  ] as const)(
    "forwards all session cookies when two-factor=%s",
    async (requiresTwoFactor, expectedBody) => {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "better-auth.session_token=token; Path=/; HttpOnly",
      );
      headers.append(
        "set-cookie",
        "better-auth.two_factor=challenge; Path=/; HttpOnly",
      );
      signInEmailMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(requiresTwoFactor ? { twoFactorRedirect: true } : {}),
          { status: 200, headers },
        ),
      );
      const { POST } = await import("@/app/api/login/password/route");

      const response = await POST(
        buildRequest({
          identifier: "user@example.test",
          password: "pass",
          locale: "en",
          next: "/settings",
        }),
      );

      await expect(response.json()).resolves.toEqual(expectedBody);
      const responseHeaders = response.headers as Headers & {
        getSetCookie?: () => string[];
      };
      expect(responseHeaders.getSetCookie).toBeTypeOf("function");
      expect(responseHeaders.getSetCookie?.()).toEqual([
        "better-auth.session_token=token; Path=/; HttpOnly",
        "better-auth.two_factor=challenge; Path=/; HttpOnly",
      ]);
    },
  );
});

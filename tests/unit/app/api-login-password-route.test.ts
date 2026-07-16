// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const signInEmailMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  clone: () => ({
    json: async () => ({}),
  }),
}));
const signInUsernameMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  clone: () => ({
    json: async () => ({}),
  }),
}));
const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);

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
    vi.resetModules();
    (globalThis as Record<string, unknown>)._failedLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginOverflowAttempts =
      undefined;
    signInEmailMock.mockClear();
    signInUsernameMock.mockClear();
    ensureAuthDatabaseReadyMock.mockClear();
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
        identifier: "user@example.com",
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
        identifier: "user@example.com",
        password: "pass",
        locale: "en",
        next: "/en/settings",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      redirectTo: "/en/settings",
    });
  });
});

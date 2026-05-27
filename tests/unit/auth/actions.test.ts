// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("@/i18n/navigation", () => ({
  redirect: (path: string) => {
    (globalThis as Record<string, unknown>).__redirectCalls = [
      ...((globalThis as Record<string, unknown>).__redirectCalls || []),
      path,
    ];
    throw new Error("__REDIRECT__");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getRequestConfig: (_cb: unknown) => ({}),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.23" }),
}));

const signInEmailMock = vi.fn(async () => ({ ok: true, status: 200 }));
const signInUsernameMock = vi.fn(async () => ({ ok: true, status: 200 }));
const signUpEmailMock = vi.fn(async () => ({ ok: true, status: 200 }));
const signOutMock = vi.fn(async () => ({ ok: true, status: 200 }));
const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const findRegistrationConflictMock = vi.fn(() => "none");

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signInEmail: signInEmailMock,
      signInUsername: signInUsernameMock,
      signUpEmail: signUpEmailMock,
      signOut: signOutMock,
    },
  },
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  findRegistrationConflict: findRegistrationConflictMock,
}));

describe("auth actions", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>).__redirectCalls = [];
    (globalThis as Record<string, unknown>)._failedLoginAttempts = undefined;
    signInEmailMock.mockReset();
    signInUsernameMock.mockReset();
    signUpEmailMock.mockReset();
    signOutMock.mockReset();
    ensureAuthDatabaseReadyMock.mockReset();
    findRegistrationConflictMock.mockReset();
    signInEmailMock.mockResolvedValue({ ok: true, status: 200 });
    signInUsernameMock.mockResolvedValue({ ok: true, status: 200 });
    signUpEmailMock.mockResolvedValue({ ok: true, status: 200 });
    signOutMock.mockResolvedValue({ ok: true, status: 200 });
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    findRegistrationConflictMock.mockReturnValue("none");
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("login: valid credentials call Better Auth and return a safe redirect target", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "pass");
    fd.set("next", "/en/test");

    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/test" });
    expect(signInEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "user@example.com", password: "pass" },
      }),
    );
    expect(signInUsernameMock).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__redirectCalls).toEqual([]);
  });

  it("login: username credentials call Better Auth username endpoint", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "admin");
    fd.set("password", "pass");

    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/" });
    expect(signInUsernameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { username: "admin", password: "pass" },
      }),
    );
    expect(signInEmailMock).not.toHaveBeenCalled();
  });

  it("login: returns requiresTwoFactor when Better Auth signals twoFactorRedirect", async () => {
    signInEmailMock.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({
        json: async () => ({ twoFactorRedirect: true }),
      }),
    });
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "pass");

    const res = await login(undefined, fd);
    expect(res).toEqual({ requiresTwoFactor: true });
  });

  it("login: invalid credentials returns error", async () => {
    signInEmailMock.mockResolvedValue({ ok: false, status: 401 });
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "wrong");
    const res = await login(undefined, fd);
    expect(res).toEqual({ errorKey: "error_invalid_credentials" });
  });

  it("login: invalid input returns error before auth call", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "");
    fd.set("password", "");
    const res = await login(undefined, fd);
    expect(res).toEqual({ errorKey: "error_invalid_credentials" });
    expect(signInEmailMock).not.toHaveBeenCalled();
  });

  it("login: unsafe next redirects to root", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "pass");
    fd.set("next", "https://evil.com/whatever");
    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/" });
    expect((globalThis as Record<string, unknown>).__redirectCalls).toEqual([]);
  });

  it("logout: signs out and redirects to login path", async () => {
    const { logout } = await import("@/app/auth/actions");
    await expect(logout()).rejects.toThrow("__REDIRECT__");
    expect(signOutMock).toHaveBeenCalled();
    const calls = (globalThis as Record<string, unknown>).__redirectCalls;
    expect(calls[calls.length - 1]).toMatch(/\/login|\/anmelden/);
  });

  it("login: applies lockout after too many failed attempts", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";

    signInEmailMock.mockResolvedValue({ ok: false, status: 401 });
    const { login } = await import("@/app/auth/actions");

    const firstAttempt = new FormData();
    firstAttempt.set("email", "user@example.com");
    firstAttempt.set("password", "wrong");
    const firstResult = await login(undefined, firstAttempt);
    expect(firstResult).toEqual({ errorKey: "error_invalid_credentials" });

    const secondAttempt = new FormData();
    secondAttempt.set("email", "user@example.com");
    secondAttempt.set("password", "wrong-again");
    const secondResult = await login(undefined, secondAttempt);
    expect(secondResult).toEqual({ errorKey: "error_too_many_attempts" });

    signInEmailMock.mockResolvedValue({ ok: true, status: 200 });
    const correctAttempt = new FormData();
    correctAttempt.set("email", "user@example.com");
    correctAttempt.set("password", "pass");
    const lockedResult = await login(undefined, correctAttempt);
    expect(lockedResult).toEqual({ errorKey: "error_too_many_attempts" });
  });

  it("register: blocks duplicate username before signup API call", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    findRegistrationConflictMock.mockReturnValue("username_in_use");
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("email", "admin@example.com");
    fd.set("password", "VeryStrongPass123");

    const res = await register(undefined, fd);

    expect(res).toEqual({ errorKey: "error_setup_username_in_use" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("register: blocks duplicate email before signup API call", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    findRegistrationConflictMock.mockReturnValue("email_in_use");
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("email", "admin@example.com");
    fd.set("password", "VeryStrongPass123");

    const res = await register(undefined, fd);

    expect(res).toEqual({ errorKey: "error_setup_email_in_use" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("register: rejects usernames outside the Better Auth default policy", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin-user");
    fd.set("email", "admin@example.com");
    fd.set("password", "VeryStrongPass123");

    const res = await register(undefined, fd);

    expect(res).toEqual({ errorKey: "error_setup_invalid_username" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });
});

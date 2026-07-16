// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("@/i18n/navigation", () => ({
  redirect: (path: string) => {
    const store = globalThis as typeof globalThis & {
      __redirectCalls?: string[];
    };
    store.__redirectCalls = [...(store.__redirectCalls ?? []), path];
    throw new Error("__REDIRECT__");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getRequestConfig: (_cb: unknown) => ({}),
}));

const requestHeaders = {
  current: new Headers({ "x-forwarded-for": "198.51.100.23" }),
};
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders.current,
}));

const signInEmailMock = vi.fn(async () => new Response(null, { status: 200 }));
const signInUsernameMock = vi.fn(
  async () => new Response(null, { status: 200 }),
);
const signUpEmailMock = vi.fn(async () => new Response(null, { status: 200 }));
const signOutMock = vi.fn(async () => new Response(null, { status: 200 }));
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
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginOverflowAttempts =
      undefined;
    signInEmailMock.mockReset();
    signInUsernameMock.mockReset();
    signUpEmailMock.mockReset();
    signOutMock.mockReset();
    ensureAuthDatabaseReadyMock.mockReset();
    findRegistrationConflictMock.mockReset();
    signInEmailMock.mockResolvedValue(new Response(null, { status: 200 }));
    signInUsernameMock.mockResolvedValue(new Response(null, { status: 200 }));
    signUpEmailMock.mockResolvedValue(new Response(null, { status: 200 }));
    signOutMock.mockResolvedValue(new Response(null, { status: 200 }));
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    findRegistrationConflictMock.mockReturnValue("none");
    requestHeaders.current = new Headers({
      "x-forwarded-for": "198.51.100.23",
    });
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";
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
    signInEmailMock.mockResolvedValue(
      new Response(JSON.stringify({ twoFactorRedirect: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "pass");

    const res = await login(undefined, fd);
    expect(res).toEqual({ requiresTwoFactor: true });
  });

  it("login: invalid credentials returns error", async () => {
    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
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

  it("login: does not strip locale-looking prefixes from normal path segments", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.com");
    fd.set("password", "pass");
    fd.set("next", "/enterprise");
    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/enterprise" });
  });

  it("logout: signs out and redirects to login path", async () => {
    const { logout } = await import("@/app/auth/actions");
    await expect(logout()).rejects.toThrow("__REDIRECT__");
    expect(signOutMock).toHaveBeenCalled();
    const calls = (globalThis as { __redirectCalls?: string[] })
      .__redirectCalls;
    expect(calls).toBeDefined();
    if (!calls) {
      throw new Error("Expected redirect call");
    }
    expect(calls[calls.length - 1]).toMatch(/\/login|\/anmelden/);
  });

  it("login: applies lockout after too many failed attempts", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";

    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
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

    signInEmailMock.mockResolvedValue(new Response(null, { status: 200 }));
    const correctAttempt = new FormData();
    correctAttempt.set("email", "user@example.com");
    correctAttempt.set("password", "pass");
    const lockedResult = await login(undefined, correctAttempt);
    expect(lockedResult).toEqual({ errorKey: "error_too_many_attempts" });
  });

  it("login: failures from one IP do not lock the account for another IP", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");

    async function attempt(password: string) {
      const data = new FormData();
      data.set("email", "user@example.com");
      data.set("password", password);
      return login(undefined, data);
    }

    await expect(attempt("wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("wrong-again")).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });

    requestHeaders.current = new Headers({
      "x-forwarded-for": "198.51.100.24",
    });
    signInEmailMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(attempt("correct")).resolves.toEqual({ redirectTo: "/en/" });
  });

  it("login: cannot rotate fallback rate limits with request headers", async () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = "false";
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    requestHeaders.current = new Headers({ "user-agent": "first-browser" });
    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");

    async function attempt(password: string) {
      const data = new FormData();
      data.set("email", "user@example.com");
      data.set("password", password);
      return login(undefined, data);
    }

    await expect(attempt("wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("wrong-again")).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });

    requestHeaders.current = new Headers({
      "user-agent": "second-browser",
      "accept-language": "de-DE",
      "x-forwarded-for": "203.0.113.99",
    });
    await expect(attempt("third-guess")).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });
    expect(signInEmailMock).toHaveBeenCalledTimes(2);
  });

  it("login: limits credential spraying across identifiers from one IP", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");

    const firstAttempt = new FormData();
    firstAttempt.set("email", "first@example.com");
    firstAttempt.set("password", "wrong");
    await expect(login(undefined, firstAttempt)).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });

    const secondAttempt = new FormData();
    secondAttempt.set("email", "second@example.com");
    secondAttempt.set("password", "wrong");
    await expect(login(undefined, secondAttempt)).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });
  });

  it("login: a successful account does not reset the shared IP spray limit", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "3";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    signInEmailMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");

    async function attempt(email: string, password: string) {
      const data = new FormData();
      data.set("email", email);
      data.set("password", password);
      return login(undefined, data);
    }

    await expect(attempt("first@example.com", "wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("second@example.com", "wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("valid@example.com", "correct")).resolves.toEqual({
      redirectTo: "/en/",
    });
    await expect(attempt("third@example.com", "wrong")).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });
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

  it.each([
    " VeryStrongPass123 ",
    "Very StrongPass123",
  ])("register: rejects password whitespace without normalizing it: %j", async (password) => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("email", "admin@example.com");
    fd.set("password", password);

    const res = await register(undefined, fd);

    expect(res).toEqual({
      errorKey: "error_setup_invalid_password_policy",
    });
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

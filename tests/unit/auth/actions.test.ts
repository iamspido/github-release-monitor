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
    fd.set("email", "user@example.test");
    fd.set("password", "pass");
    fd.set("next", "/en/test");

    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/test" });
    expect(signInEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "user@example.test", password: "pass" },
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
    fd.set("email", "user@example.test");
    fd.set("password", "pass");

    const res = await login(undefined, fd);
    expect(res).toEqual({ requiresTwoFactor: true });
  });

  it("login: invalid credentials returns error", async () => {
    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.test");
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
    fd.set("email", "user@example.test");
    fd.set("password", "pass");
    fd.set("next", "https://evil.test/whatever");
    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/" });
    expect((globalThis as Record<string, unknown>).__redirectCalls).toEqual([]);
  });

  it("login: does not strip locale-looking prefixes from normal path segments", async () => {
    const { login } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("email", "user@example.test");
    fd.set("password", "pass");
    fd.set("next", "/enterprise");
    const result = await login(undefined, fd);
    expect(result).toEqual({ redirectTo: "/en/enterprise" });
  });

  it("logout: signs out and returns the locale-aware login route", async () => {
    const { logout } = await import("@/app/auth/actions");
    const result = await logout();

    expect(signOutMock).toHaveBeenCalled();
    expect(result).toEqual({ redirectTo: "/login" });
    expect((globalThis as Record<string, unknown>).__redirectCalls).toEqual([]);
  });

  it("login: applies lockout after too many failed attempts", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "60";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";

    signInEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { login } = await import("@/app/auth/actions");

    const firstAttempt = new FormData();
    firstAttempt.set("email", "user@example.test");
    firstAttempt.set("password", "wrong");
    const firstResult = await login(undefined, firstAttempt);
    expect(firstResult).toEqual({ errorKey: "error_invalid_credentials" });

    const secondAttempt = new FormData();
    secondAttempt.set("email", "user@example.test");
    secondAttempt.set("password", "wrong-again");
    const secondResult = await login(undefined, secondAttempt);
    expect(secondResult).toEqual({ errorKey: "error_too_many_attempts" });

    signInEmailMock.mockResolvedValue(new Response(null, { status: 200 }));
    const correctAttempt = new FormData();
    correctAttempt.set("email", "user@example.test");
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
      data.set("email", "user@example.test");
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
      data.set("email", "user@example.test");
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
    firstAttempt.set("email", "first@example.test");
    firstAttempt.set("password", "wrong");
    await expect(login(undefined, firstAttempt)).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });

    const secondAttempt = new FormData();
    secondAttempt.set("email", "second@example.test");
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

    await expect(attempt("first@example.test", "wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("second@example.test", "wrong")).resolves.toEqual({
      errorKey: "error_invalid_credentials",
    });
    await expect(attempt("valid@example.test", "correct")).resolves.toEqual({
      redirectTo: "/en/",
    });
    await expect(attempt("third@example.test", "wrong")).resolves.toEqual({
      errorKey: "error_too_many_attempts",
    });
  });

  it("register: blocks duplicate username before signup API call", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    findRegistrationConflictMock.mockReturnValue("username_in_use");
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("email", "admin@example.test");
    fd.set("password", "VeryStrongPass123");

    const res = await register(undefined, fd);

    expect(res).toEqual({ errorKey: "error_setup_username_in_use" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it.each([" VeryStrongPass123 ", "Very StrongPass123"])(
    "register: rejects password whitespace without normalizing it: %j",
    async (password) => {
      process.env.AUTH_ENABLE_SIGNUP = "true";
      const { register } = await import("@/app/auth/actions");
      const fd = new FormData();
      fd.set("username", "admin");
      fd.set("email", "admin@example.test");
      fd.set("password", password);

      const res = await register(undefined, fd);

      expect(res).toEqual({
        errorKey: "error_setup_invalid_password_policy",
      });
      expect(signUpEmailMock).not.toHaveBeenCalled();
    },
  );

  it("register: blocks duplicate email before signup API call", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    findRegistrationConflictMock.mockReturnValue("email_in_use");
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("email", "admin@example.test");
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
    fd.set("email", "admin@example.test");
    fd.set("password", "VeryStrongPass123");

    const res = await register(undefined, fd);

    expect(res).toEqual({ errorKey: "error_setup_invalid_username" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("register: rejects requests when public signup is disabled", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "false";
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "release_user");
    fd.set("email", "user@example.test");
    fd.set("password", "VeryStrongPass123");

    await expect(register(undefined, fd)).resolves.toEqual({
      errorKey: "error_setup_unavailable",
    });
    expect(ensureAuthDatabaseReadyMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("register: validates and normalizes email before opening the database", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "release_user");
    fd.set("email", "not-an-email");
    fd.set("password", "VeryStrongPass123");

    await expect(register(undefined, fd)).resolves.toEqual({
      errorKey: "error_setup_invalid_email",
    });
    expect(ensureAuthDatabaseReadyMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("register: submits normalized account data and redirects to login", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", " release_user ");
    fd.set("email", " USER@EXAMPLE.TEST ");
    fd.set("password", "VeryStrongPass123");
    fd.set("name", " ");

    await expect(register(undefined, fd)).rejects.toThrow("__REDIRECT__");

    expect(ensureAuthDatabaseReadyMock).toHaveBeenCalledOnce();
    expect(findRegistrationConflictMock).toHaveBeenCalledWith(
      "release_user",
      "user@example.test",
    );
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: requestHeaders.current,
        body: {
          email: "user@example.test",
          password: "VeryStrongPass123",
          username: "release_user",
          name: "release_user",
        },
        asResponse: true,
      }),
    );
    expect(
      (globalThis as { __redirectCalls?: string[] }).__redirectCalls,
    ).toEqual(["/login?registered=1"]);
  });

  it.each([
    ["EMAIL_ALREADY_IN_USE", "error_setup_email_in_use"],
    ["username_taken", "error_setup_username_in_use"],
    ["weak_password", "error_setup_invalid_password_policy"],
    ["unexpected_error", "error_setup_failed"],
  ])(
    "register: maps Better Auth error %s",
    async (errorCode, expectedErrorKey) => {
      process.env.AUTH_ENABLE_SIGNUP = "true";
      signUpEmailMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: errorCode }), { status: 422 }),
      );
      const { register } = await import("@/app/auth/actions");
      const fd = new FormData();
      fd.set("username", "release_user");
      fd.set("email", "user@example.test");
      fd.set("password", "VeryStrongPass123");

      await expect(register(undefined, fd)).resolves.toEqual({
        errorKey: expectedErrorKey,
      });
    },
  );

  it("register: falls back safely when Better Auth returns malformed error JSON", async () => {
    process.env.AUTH_ENABLE_SIGNUP = "true";
    signUpEmailMock.mockResolvedValueOnce(
      new Response("not-json", { status: 500 }),
    );
    const { register } = await import("@/app/auth/actions");
    const fd = new FormData();
    fd.set("username", "release_user");
    fd.set("email", "user@example.test");
    fd.set("password", "VeryStrongPass123");

    await expect(register(undefined, fd)).resolves.toEqual({
      errorKey: "error_setup_failed",
    });
  });
});

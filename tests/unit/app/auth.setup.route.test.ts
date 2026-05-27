const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasAnyAuthUserMock = vi.fn(() => "no_user");
const signUpEmailMock = vi.fn(async () => new Response(null, { status: 201 }));

vi.mock("@/lib/auth", () => ({
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  hasAnyAuthUser: hasAnyAuthUserMock,
  setupAuth: {
    api: {
      signUpEmail: signUpEmailMock,
    },
  },
}));

const isAuthSetupLockedMock = vi.fn(async () => false);
const writeAuthSetupLockMock = vi.fn(async () => "created" as const);
const releaseAuthSetupBootstrapLockMock = vi.fn(async () => undefined);
const acquireAuthSetupBootstrapLockMock = vi.fn(async () => ({
  status: "acquired" as const,
  release: releaseAuthSetupBootstrapLockMock,
}));
const getAuthSetupLockPathMock = vi.fn(() => "/app/data/auth-setup.lock");

vi.mock("@/lib/auth/setup-lock", () => ({
  acquireAuthSetupBootstrapLock: acquireAuthSetupBootstrapLockMock,
  isAuthSetupLocked: isAuthSetupLockedMock,
  writeAuthSetupLock: writeAuthSetupLockMock,
  getAuthSetupLockPath: getAuthSetupLockPathMock,
}));

const scopedLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  withScope: vi.fn(),
};
const withScopeMock = vi.fn(() => scopedLogger);

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: withScopeMock,
  },
}));

function setupRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("auth setup route", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...env,
      AUTH_SETUP_TOKEN: "x".repeat(64),
    };
    (
      globalThis as typeof globalThis & {
        _authSetupTokenWarningLogged?: boolean;
      }
    )._authSetupTokenWarningLogged = undefined;

    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    hasAnyAuthUserMock.mockReturnValue("no_user");
    signUpEmailMock.mockResolvedValue(new Response(null, { status: 201 }));
    isAuthSetupLockedMock.mockResolvedValue(false);
    writeAuthSetupLockMock.mockResolvedValue("created");
    releaseAuthSetupBootstrapLockMock.mockResolvedValue(undefined);
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: "acquired",
      release: releaseAuthSetupBootstrapLockMock,
    });
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("GET: logs missing setup token only once and returns 404", async () => {
    delete process.env.AUTH_SETUP_TOKEN;
    const { GET } = await import("@/app/api/auth/setup/route");

    const first = await GET();
    const second = await GET();

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(scopedLogger.error).toHaveBeenCalledTimes(1);
  });

  it("GET: returns 404 when setup lock file already exists", async () => {
    isAuthSetupLockedMock.mockResolvedValue(true);
    const { GET } = await import("@/app/api/auth/setup/route");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(hasAnyAuthUserMock).not.toHaveBeenCalled();
  });

  it("GET: backfills setup lock when users already exist", async () => {
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { GET } = await import("@/app/api/auth/setup/route");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(writeAuthSetupLockMock).toHaveBeenCalledWith({
      reason: "user_exists",
      source: "/api/auth/setup",
    });
  });

  it("GET: fails closed when auth user existence cannot be determined", async () => {
    hasAnyAuthUserMock.mockReturnValue("unknown");
    const { GET } = await import("@/app/api/auth/setup/route");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(writeAuthSetupLockMock).not.toHaveBeenCalled();
  });

  it("POST: creates first user and writes persistent setup lock", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        name: "Admin",
        username: "admin",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "admin@example.com",
          password: "SuperSecurePass123",
          name: "Admin",
          username: "admin",
        },
        asResponse: true,
      }),
    );
    expect(writeAuthSetupLockMock).toHaveBeenCalledWith({
      reason: "setup_completed",
      email: "admin@example.com",
      source: "/api/auth/setup",
    });
    expect(acquireAuthSetupBootstrapLockMock).toHaveBeenCalledWith({
      source: "/api/auth/setup",
    });
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
  });

  it("POST: forwards username during initial setup", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        name: "Admin",
        username: "admin",
      }),
    );

    expect(response.status).toBe(201);
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "admin@example.com",
          password: "SuperSecurePass123",
          name: "Admin",
          username: "admin",
        },
      }),
    );
  });

  it("POST: rejects missing username", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        name: "Admin",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_username",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("POST: rejects usernames outside the Better Auth default policy", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin-user",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_username",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("POST: rejects passwords that do not meet policy requirements", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "lowercaseonly12",
        username: "admin",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_password_policy",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("POST: maps Better Auth duplicate email errors to email_already_exists", async () => {
    signUpEmailMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "USER_ALREADY_EXISTS",
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const { POST } = await import("@/app/api/auth/setup/route");
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "email_already_exists",
    });
  });

  it("POST: returns 404 when setup lock exists even with valid token", async () => {
    isAuthSetupLockedMock.mockResolvedValue(true);
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(404);
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(acquireAuthSetupBootstrapLockMock).not.toHaveBeenCalled();
  });

  it("POST: fails closed when auth user existence cannot be determined", async () => {
    hasAnyAuthUserMock.mockReturnValue("unknown");
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(acquireAuthSetupBootstrapLockMock).not.toHaveBeenCalled();
  });

  it("POST: returns 409 when another setup bootstrap is already in progress", async () => {
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: "busy",
      release: releaseAuthSetupBootstrapLockMock,
    });
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "setup_in_progress",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).not.toHaveBeenCalled();
  });

  it("POST: rechecks existing users after acquiring setup bootstrap lock", async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce("no_user")
      .mockReturnValueOnce("has_user");
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(404);
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(writeAuthSetupLockMock).toHaveBeenCalledWith({
      reason: "user_exists",
      source: "/api/auth/setup",
    });
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
  });

  it("POST: fails closed when rechecking users after acquiring setup bootstrap lock fails", async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce("no_user")
      .mockReturnValueOnce("unknown");
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "setup_state_unknown",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
  });

  it("POST: returns 500 when lock persistence fails after signup", async () => {
    writeAuthSetupLockMock.mockRejectedValue(new Error("disk full"));
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        email: "admin@example.com",
        password: "SuperSecurePass123",
        username: "admin",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "setup_lock_failed",
    });
    expect(scopedLogger.error).toHaveBeenCalled();
  });
});

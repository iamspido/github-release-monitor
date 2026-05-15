const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasAnyAuthUserMock = vi.fn(() => "no_user");

vi.mock('@/lib/auth', () => ({
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  hasAnyAuthUser: hasAnyAuthUserMock,
}));

const isAuthSetupLockedMock = vi.fn(async () => false);

vi.mock('@/lib/auth-setup-lock', () => ({
  isAuthSetupLocked: isAuthSetupLockedMock,
}));

vi.mock('@/lib/logger', () => ({
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

function setupRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/setup/social-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('auth setup social-context route', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...env,
      AUTH_SETUP_TOKEN: 'x'.repeat(64),
      AUTH_GITHUB_CLIENT_ID: 'github-id',
      AUTH_GITHUB_CLIENT_SECRET: 'github-secret',
    };
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    hasAnyAuthUserMock.mockReturnValue("no_user");
    isAuthSetupLockedMock.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('creates setup social context and returns cookie header', async () => {
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        provider: 'github',
        username: 'admin',
        name: 'Admin User',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
  });

  it('fails closed when auth user existence cannot be determined', async () => {
    hasAnyAuthUserMock.mockReturnValue('unknown');
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        provider: 'github',
        username: 'admin',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'setup_state_unknown',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns 404 and does not issue cookie when an auth user already exists', async () => {
    hasAnyAuthUserMock.mockReturnValue('has_user');
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        provider: 'github',
        username: 'admin',
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects missing username', async () => {
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        provider: 'github',
        username: '',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_username",
    });
  });

  it('rejects usernames outside the Better Auth default policy', async () => {
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: process.env.AUTH_SETUP_TOKEN,
        provider: 'github',
        username: 'admin-user',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_username',
    });
  });

  it('rejects invalid setup token', async () => {
    const { POST } = await import('@/app/api/auth/setup/social-context/route');
    const response = await POST(
      setupRequest({
        token: 'invalid',
        provider: 'github',
        username: 'admin',
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_setup_token',
    });
  });
});

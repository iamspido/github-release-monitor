const ensureAuthDatabaseReadyMock = vi.fn(async () => undefined);
const hasAnyAuthUserMock = vi.fn(() => "no_user");
const hasValidAuthSessionForRequestMock = vi.fn(() => false);
const ensureInitialAuthUserProfileMock = vi.fn(() => null);
const getAuthUserIdSnapshotMock = vi.fn(() => new Set(['existing-user']));
const applySocialRegistrationProfileMock = vi.fn(() => 'applied');
const isSignupEnabledMock = vi.fn(() => false);

const authInstance = { kind: 'auth' };
const setupAuthInstance = { kind: 'setup-auth' };
const authGetMock = vi.fn(async () => new Response(null, { status: 200 }));
const authPostMock = vi.fn(async () => new Response(null, { status: 200 }));
const setupGetMock = vi.fn(async () => new Response(null, { status: 200 }));
const setupPostMock = vi.fn(async () => new Response(null, { status: 200 }));

const toNextJsHandlerMock = vi.fn((instance: unknown) => {
  if (instance === setupAuthInstance) {
    return {
      GET: setupGetMock,
      POST: setupPostMock,
    };
  }
  return {
    GET: authGetMock,
    POST: authPostMock,
  };
});

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: toNextJsHandlerMock,
}));

vi.mock('@/lib/auth', () => ({
  auth: authInstance,
  setupAuth: setupAuthInstance,
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
  hasAnyAuthUser: hasAnyAuthUserMock,
  hasValidAuthSessionForRequest: hasValidAuthSessionForRequestMock,
  ensureInitialAuthUserProfile: ensureInitialAuthUserProfileMock,
  getAuthUserIdSnapshot: getAuthUserIdSnapshotMock,
  applySocialRegistrationProfile: applySocialRegistrationProfileMock,
  isSignupEnabled: isSignupEnabledMock,
}));

const isAuthSetupLockedMock = vi.fn(async () => false);
const writeAuthSetupLockMock = vi.fn(async () => 'created');
const releaseAuthSetupBootstrapLockMock = vi.fn(async () => undefined);
const acquireAuthSetupBootstrapLockMock = vi.fn(async () => ({
  status: 'acquired' as const,
  release: releaseAuthSetupBootstrapLockMock,
}));

vi.mock('@/lib/auth-setup-lock', () => ({
  acquireAuthSetupBootstrapLock: acquireAuthSetupBootstrapLockMock,
  isAuthSetupLocked: isAuthSetupLockedMock,
  writeAuthSetupLock: writeAuthSetupLockMock,
}));

const readSetupSocialContextFromRequestMock = vi.fn(() => ({
  username: 'admin',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
}));
const buildSetupSocialContextSetCookieHeaderMock = vi.fn(
  () => 'auth_setup_social_context=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
);

vi.mock('@/lib/auth-setup-social-context', () => ({
  readSetupSocialContextFromRequest: readSetupSocialContextFromRequestMock,
  buildSetupSocialContextSetCookieHeader:
    buildSetupSocialContextSetCookieHeaderMock,
}));

const readSocialLoginIntentFromRequestMock = vi.fn(() => null);
const buildSocialLoginIntentSetCookieHeaderMock = vi.fn(
  () => 'auth_social_login_intent=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
);

vi.mock('@/lib/auth-social-login-intent', () => ({
  readSocialLoginIntentFromRequest: readSocialLoginIntentFromRequestMock,
  buildSocialLoginIntentSetCookieHeader: buildSocialLoginIntentSetCookieHeaderMock,
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

describe('auth catch-all route setup social cookie handling', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...env,
      AUTH_SETUP_TOKEN: 'x'.repeat(64),
    };
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
    hasAnyAuthUserMock.mockReturnValue("no_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(false);
    getAuthUserIdSnapshotMock.mockReturnValue(new Set(['existing-user']));
    applySocialRegistrationProfileMock.mockReturnValue('applied');
    isSignupEnabledMock.mockReturnValue(false);
    isAuthSetupLockedMock.mockResolvedValue(false);
    releaseAuthSetupBootstrapLockMock.mockResolvedValue(undefined);
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: 'acquired',
      release: releaseAuthSetupBootstrapLockMock,
    });
    readSetupSocialContextFromRequestMock.mockReturnValue({
      username: 'admin',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    readSocialLoginIntentFromRequestMock.mockReturnValue(null);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('does not clear setup context cookie on sign-in/social request', async () => {
    setupPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/login/oauth/authorize' },
      }),
    );
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const response = await POST(
      new Request('http://localhost/api/auth/sign-in/social', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(302);
    expect(setupPostMock).toHaveBeenCalledTimes(1);
    expect(buildSetupSocialContextSetCookieHeaderMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('clears setup context cookie on callback request', async () => {
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/de/login' },
      }),
    );
    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(302);
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(acquireAuthSetupBootstrapLockMock).toHaveBeenCalledWith({
      source: '/api/auth/callback/github',
    });
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(buildSetupSocialContextSetCookieHeaderMock).toHaveBeenCalledWith(
      null,
    );
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
  });

  it('blocks social sign-in without valid intent when signup is disabled', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const response = await POST(
      new Request('http://localhost/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(authPostMock).not.toHaveBeenCalled();
    expect(setupPostMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain(
      'auth_social_login_intent=',
    );
  });

  it('allows social sign-in with valid intent when signup is disabled', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: 'github',
      purpose: 'login',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce',
    });
    authPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/login/oauth/authorize' },
      }),
    );
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const response = await POST(
      new Request('http://localhost/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
    );

    expect(response.status).toBe(302);
    expect(authPostMock).toHaveBeenCalledTimes(1);
  });

  it('blocks social sign-in without valid intent even when signup is enabled', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    isSignupEnabledMock.mockReturnValue(true);

    const { POST } = await import('@/app/api/auth/[...all]/route');
    const response = await POST(
      new Request('http://localhost/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(authPostMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain(
      'auth_social_login_intent=',
    );
  });

  it('allows authenticated social linking flow without social precheck intent', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(true);
    authPostMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/login/oauth/authorize' },
      }),
    );

    const { POST } = await import('@/app/api/auth/[...all]/route');
    const response = await POST(
      new Request('http://localhost/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
    );

    expect(response.status).toBe(302);
    expect(authPostMock).toHaveBeenCalledTimes(1);
  });

  it('does not block social callback without precheck intent', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    hasValidAuthSessionForRequestMock.mockReturnValue(false);
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/en/login?error=signup_disabled' },
      }),
    );

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(302);
    expect(authGetMock).toHaveBeenCalledTimes(1);
  });

  it('blocks setup social callback when another setup bootstrap is in progress', async () => {
    acquireAuthSetupBootstrapLockMock.mockResolvedValue({
      status: 'busy',
      release: releaseAuthSetupBootstrapLockMock,
    });

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'setup_in_progress',
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
    expect(releaseAuthSetupBootstrapLockMock).not.toHaveBeenCalled();
  });

  it('fails closed for setup social flow when auth user existence cannot be determined', async () => {
    hasAnyAuthUserMock.mockReturnValue('unknown');

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'setup_state_unknown',
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
  });

  it('fails closed for setup social callback when user recheck after lock is unknown', async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce('no_user')
      .mockReturnValueOnce('unknown');

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'setup_state_unknown',
    });
    expect(setupGetMock).not.toHaveBeenCalled();
    expect(authGetMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
  });

  it('fails closed after setup social callback when final user check is unknown', async () => {
    hasAnyAuthUserMock
      .mockReturnValueOnce('no_user')
      .mockReturnValueOnce('no_user')
      .mockReturnValueOnce('unknown');
    setupGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/de/login' },
      }),
    );

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'setup_state_unknown',
    });
    expect(setupGetMock).toHaveBeenCalledTimes(1);
    expect(writeAuthSetupLockMock).not.toHaveBeenCalled();
    expect(releaseAuthSetupBootstrapLockMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get('set-cookie')).toContain(
      'auth_setup_social_context=',
    );
  });

  it('applies register social intent username to the newly created callback user', async () => {
    const snapshot = new Set(['existing-user']);
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    getAuthUserIdSnapshotMock.mockReturnValue(snapshot);
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: 'github',
      purpose: 'register',
      username: 'AdminUser',
      email: 'admin@example.com',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce',
    });
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/en' },
      }),
    );

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(302);
    expect(getAuthUserIdSnapshotMock).toHaveBeenCalledTimes(1);
    expect(applySocialRegistrationProfileMock).toHaveBeenCalledWith({
      previousUserIds: snapshot,
      username: 'AdminUser',
      email: 'admin@example.com',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'auth_social_login_intent=',
    );
  });

  it('does not apply register social intent when callback provider differs', async () => {
    readSetupSocialContextFromRequestMock.mockReturnValue(null);
    hasAnyAuthUserMock.mockReturnValue("has_user");
    readSocialLoginIntentFromRequestMock.mockReturnValue({
      provider: 'google',
      purpose: 'register',
      username: 'AdminUser',
      email: 'admin@example.com',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce',
    });
    authGetMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/en' },
      }),
    );

    const { GET } = await import('@/app/api/auth/[...all]/route');
    const response = await GET(
      new Request('http://localhost/api/auth/callback/github', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(302);
    expect(getAuthUserIdSnapshotMock).not.toHaveBeenCalled();
    expect(applySocialRegistrationProfileMock).not.toHaveBeenCalled();
  });
});

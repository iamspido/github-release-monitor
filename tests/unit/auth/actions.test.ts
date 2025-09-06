// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('@/navigation', () => ({
  redirect: (path: string) => {
    (globalThis as any).__redirectCalls = [...((globalThis as any).__redirectCalls || []), path];
    throw new Error('__REDIRECT__');
  },
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  // i18n.ts imports getRequestConfig at module scope
  getRequestConfig: (cb: any) => ({}) as any,
}));

const sessionMock = {
  isLoggedIn: false,
  username: undefined as any,
  save: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('@/lib/session', () => ({
  getSession: async () => sessionMock,
}));

describe('auth actions', () => {
  const env = { ...process.env };
  beforeEach(() => { vi.resetModules(); (globalThis as any).__redirectCalls = []; });
  afterEach(() => { process.env = { ...env }; });

  it('login: valid credentials set session and redirect safely', async () => {
    process.env.AUTH_USERNAME = 'user';
    process.env.AUTH_PASSWORD = 'pass';

    const { login } = await import('@/app/auth/actions');
    const fd = new FormData();
    fd.set('username', 'user');
    fd.set('password', 'pass');
    fd.set('next', '/en/test');

    await expect(login(undefined, fd)).rejects.toThrow('__REDIRECT__');
    expect(sessionMock.isLoggedIn).toBe(true);
    expect(sessionMock.username).toBe('user');
    // redirected to path without locale prefix
    const calls = (globalThis as any).__redirectCalls;
    expect(calls[calls.length - 1]).toBe('/test');
  });

  it('login: invalid credentials returns error', async () => {
    process.env.AUTH_USERNAME = 'user';
    process.env.AUTH_PASSWORD = 'pass';
    const { login } = await import('@/app/auth/actions');
    const fd = new FormData();
    fd.set('username', 'user');
    fd.set('password', 'wrong');
    const res = await login(undefined, fd);
    expect(res).toEqual({ errorKey: 'error_invalid_credentials' });
  });

  it('login: invalid input types return error', async () => {
    process.env.AUTH_USERNAME = 'user';
    process.env.AUTH_PASSWORD = 'pass';
    const { login } = await import('@/app/auth/actions');
    const fd = new FormData();
    fd.set('username', '');
    fd.set('password', '');
    const res = await login(undefined, fd);
    expect(res).toEqual({ errorKey: 'error_invalid_credentials' });
  });

  it('login: unsafe next redirects to root', async () => {
    process.env.AUTH_USERNAME = 'user';
    process.env.AUTH_PASSWORD = 'pass';
    const { login } = await import('@/app/auth/actions');
    const fd = new FormData();
    fd.set('username', 'user');
    fd.set('password', 'pass');
    fd.set('next', 'https://evil.com/whatever');
    await expect(login(undefined, fd)).rejects.toThrow('__REDIRECT__');
    const calls = (globalThis as any).__redirectCalls;
    expect(calls[calls.length - 1]).toBe('/');
  });

  it('logout: destroys session and redirects to login path', async () => {
    const { logout } = await import('@/app/auth/actions');
    await expect(logout()).rejects.toThrow('__REDIRECT__');
    expect(sessionMock.destroy).toHaveBeenCalled();
    const calls = (globalThis as any).__redirectCalls;
    expect(calls[calls.length - 1]).toMatch(/\/login|\/anmelden/);
  });
});

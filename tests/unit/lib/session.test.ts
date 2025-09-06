describe('session cookie options based on HTTPS env', () => {
  const envBackup = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('secure true by default', async () => {
    delete process.env.HTTPS;
    const mod = await import('@/lib/session');
    expect(mod.sessionOptions.cookieOptions.secure).toBe(true);
  });

  it('secure false when HTTPS=false', async () => {
    process.env.HTTPS = 'false';
    const mod = await import('@/lib/session');
    expect(mod.sessionOptions.cookieOptions.secure).toBe(false);
  });

  it('logs critical error when AUTH_SECRET is missing or too short', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.AUTH_SECRET; // simulate missing secret overriding setup
    // ensure the one-time startup check runs again
    // @ts-ignore
    delete (global as any)._authSecretChecked;
    await import('@/lib/session');
    expect(spy).toHaveBeenCalled();
    const callArg = (spy.mock.calls[0] && spy.mock.calls[0][0]) || '';
    expect(String(callArg)).toMatch(/Missing or insecure AUTH_SECRET/);
    spy.mockRestore();
  });
});


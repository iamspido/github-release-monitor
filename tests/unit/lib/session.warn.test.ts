describe('session warnings in production over HTTP', () => {
  const envBackup = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...envBackup }; });

  it('logs a warning when NODE_ENV=production and HTTPS=false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.HTTPS = 'false';
    process.env.AUTH_SECRET = 'x'.repeat(64);
    // reset one-time flag
    // @ts-ignore
    delete (global as any)._httpWarningIssued;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('@/lib/session');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});


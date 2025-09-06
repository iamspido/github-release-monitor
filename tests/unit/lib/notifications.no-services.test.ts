// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

describe('sendNotification with no services configured', () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    // @ts-ignore
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...envBackup };
    global.fetch = fetchBackup;
  });

  it('logs a warning and resolves without sending', async () => {
    delete process.env.MAIL_HOST;
    delete process.env.APPRISE_URL;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendNotification } = await import('@/lib/notifications');

    const repo: any = { id: 'o/r', url: 'https://github.com/o/r' };
    const release: any = {
      id: 1, html_url: '#', tag_name: 'v1', name: 'v1', body: 'x',
      created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false,
    };
    await expect(sendNotification(repo, release, 'en', { timeFormat: '24h' } as any)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    // Ensure no HTTP call attempted
    expect((global.fetch as any).mock.calls.length).toBe(0);
    warnSpy.mockRestore();
  });
});


// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
}));

describe('sendTestAppriseNotification success path', () => {
  const env = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    // @ts-ignore
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...env };
    global.fetch = fetchBackup;
  });

  it('returns when APPRISE_URL set and server responds 200', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const { sendTestAppriseNotification } = await import('@/lib/notifications');
    const repo: any = { id: 'o/r', url: 'https://github.com/o/r' };
    const release: any = {
      id: 1,
      html_url: '#', tag_name: 'v1', name: 'v1', body: 'x',
      created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false,
    };
    await expect(sendTestAppriseNotification(repo, release, 'en', { timeFormat: '24h' } as any)).resolves.toBeUndefined();
    expect((global.fetch as any).mock.calls.length).toBe(1);
  });
});


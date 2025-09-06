// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
}));

describe('notifications markdown limits', () => {
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

  const repo = { id: 'owner/repo', url: 'https://github.com/owner/repo' } as any;
  const release = {
    id: 1,
    html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    tag_name: 'v1.0.0',
    name: 'v1',
    body: 'release notes',
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  } as any;

  it('when availableLength <= 0, body becomes view_on_github_link', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const { sendNotification } = await import('@/lib/notifications');

    const settings = { timeFormat: '24h', appriseMaxCharacters: 1 } as any; // forces availableLength <= 0
    const repoOverrides = { ...repo, appriseFormat: 'markdown' };
    await sendNotification(repoOverrides as any, release as any, 'en', settings);

    const call = (global.fetch as any).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.body).toBe('view_on_github_link');
  });

  it('when body shorter than limit, appends footer and link', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const { sendNotification } = await import('@/lib/notifications');

    const settings = { timeFormat: '24h', appriseMaxCharacters: 10000 } as any; // large limit
    const repoOverrides = { ...repo, appriseFormat: 'markdown' };
    await sendNotification(repoOverrides as any, release as any, 'en', settings);

    const call = (global.fetch as any).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.body).toContain('view_on_github_link');
    expect(payload.body).toContain('---'); // footer separator present
  });
});


// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
}));

// Mock html body generator to a known value
vi.mock('@/lib/email', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    generateHtmlReleaseBody: async () => '<html>hello</html>',
  };
});

describe('notifications html format route', () => {
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

  it('uses HTML generator and does not truncate', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const { sendNotification } = await import('@/lib/notifications');

    const repo = { id: 'o/r', url: 'https://github.com/o/r', appriseFormat: 'html' } as any;
    const release = {
      id: 1, html_url: '#', tag_name: 'v1', name: 'v1', body: 'x',
      created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false,
    } as any;
    // appriseMaxCharacters small should not affect html format
    const settings = { timeFormat: '24h', appriseMaxCharacters: 1 } as any;

    await sendNotification(repo, release, 'en', settings);
    const call = (global.fetch as any).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.format).toBe('html');
    expect(payload.body).toBe('<html>hello</html>');
  });
});


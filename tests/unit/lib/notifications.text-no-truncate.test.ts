// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

describe('notifications text format no truncate for small body', () => {
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

  it('uses text format and does not truncate when under limit', async () => {
    process.env.APPRISE_URL = 'http://apprise.test/notify';
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const { sendNotification } = await import('@/lib/notifications');

    const repo: any = { id: 'o/r', url: 'https://github.com/o/r', appriseFormat: 'text' };
    const release: any = {
      id: 1, html_url: '#', tag_name: 'v1', name: 'v1', body: 'short',
      created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false,
    };
    const settings: any = { timeFormat: '24h', appriseMaxCharacters: 10000 };

    await sendNotification(repo, release, 'en', settings);
    const call = (global.fetch as any).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.format).toBe('text');
    // Plain text generation includes the label key; ensures body is untruncated and composed
    expect(payload.body).toContain('text_release_notes_label');
  });
});


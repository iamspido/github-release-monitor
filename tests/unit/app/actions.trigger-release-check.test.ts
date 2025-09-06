// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));

// Basic cache stubs
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
}));

// In-memory storage by default
const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

describe('triggerReleaseCheckAction', () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => { vi.resetModules(); process.env = { ...envBackup }; mem.repos = []; /* @ts-ignore */ global.fetch = vi.fn(); });
  afterEach(() => { process.env = { ...envBackup }; global.fetch = fetchBackup; });

  it('returns not_configured message when neither SMTP nor Apprise configured', async () => {
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_FROM_ADDRESS;
    delete process.env.MAIL_TO_ADDRESS;
    delete process.env.APPRISE_URL;
    const { triggerReleaseCheckAction } = await import('@/app/actions');
    const res = await triggerReleaseCheckAction();
    expect(res).toEqual({ success: false, message: 'toast_no_notification_service_configured' });
  });

  it('returns email_sent message when a new release triggers a notification', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // Existing repo with seen tag v1; new release v2 should count
    mem.repos = [{ id: 'o/r', url: 'https://github.com/o/r', lastSeenReleaseTag: 'v1' }];

    // First fetch call: GitHub releases
    // Second fetch call: Apprise notify (ok)
    // @ts-ignore
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([{ id: 2, html_url: '#', tag_name: 'v2', name: 'v2', body: 'x', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { triggerReleaseCheckAction } = await import('@/app/actions');
    const res = await triggerReleaseCheckAction();
    expect(res.success).toBe(true);
    expect(res.message).toBe('toast_trigger_check_success_email_sent');
  });

  it('returns no_email message when no repos (0 notifications)', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    mem.repos = [];
    const { triggerReleaseCheckAction } = await import('@/app/actions');
    const res = await triggerReleaseCheckAction();
    expect(res.success).toBe(true);
    expect(res.message).toBe('toast_trigger_check_success_no_email');
  });

  it('returns error message when underlying check throws', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // Remock repository-storage to throw when fetching repos inside checkForNewReleases
    vi.doMock('@/lib/repository-storage', () => ({
      getRepositories: async () => { throw new Error('boom'); },
      saveRepositories: async () => {}
    }));
    const { triggerReleaseCheckAction } = await import('@/app/actions');
    const res = await triggerReleaseCheckAction();
    expect(res.success).toBe(false);
    expect(res.message).toBe('boom');
  });
});


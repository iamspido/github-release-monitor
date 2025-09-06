// vitest globals enabled

// Mocks
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

// In-memory repository store mock
const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => ({
    timeFormat: '24h',
    locale: 'en',
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    releaseChannels: ['stable'],
    showAcknowledge: true,
  }),
}));

// Mock notifications to capture/send/throw
const sendNotificationMock = vi.fn();
vi.mock('@/lib/notifications', async (orig) => {
  const actual = await orig();
  return { ...actual, sendNotification: (...args: any[]) => sendNotificationMock(...args) };
});

describe('deduplication in checkForNewReleases', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    sendNotificationMock.mockReset();
  });

  it('first fetch sets lastSeenReleaseTag without notifying', async () => {
    // Mock fetch to return a single release
    const nowIso = new Date().toISOString();
    // @ts-ignore
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ([{
        id: 1,
        html_url: '#',
        tag_name: 'v1',
        name: 'v1',
        body: 'x',
        created_at: nowIso,
        published_at: nowIso,
        prerelease: false,
        draft: false,
      }]),
    });

    const actions = await import('@/app/actions');
    mem.repos = [ { id: 'o/r', url: 'https://github.com/o/r' } ];

    const res = await actions.checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(0);
    expect(mem.repos[0].lastSeenReleaseTag).toBe('v1');
  });

  it('new release updates lastSeenReleaseTag even if notification fails', async () => {
    const nowIso = new Date().toISOString();
    // @ts-ignore
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ([{
        id: 2,
        html_url: '#',
        tag_name: 'v2',
        name: 'v2',
        body: 'x',
        created_at: nowIso,
        published_at: nowIso,
        prerelease: false,
        draft: false,
      }]),
    });

    const actions = await import('@/app/actions');
    sendNotificationMock.mockRejectedValueOnce(new Error('fail'));

    mem.repos = [ { id: 'o/r', url: 'https://github.com/o/r', lastSeenReleaseTag: 'v1' } ];

    const res = await actions.checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(0);
    expect(mem.repos[0].lastSeenReleaseTag).toBe('v2');
  });
});


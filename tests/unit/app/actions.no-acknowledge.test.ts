// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

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
    showAcknowledge: false, // key for this test
  }),
}));

const sendNotificationMock = vi.fn();
vi.mock('@/lib/notifications', async (orig) => {
  const actual = await orig();
  return { ...actual, sendNotification: (...args: any[]) => sendNotificationMock(...args) };
});

describe('checkForNewReleases with showAcknowledge=false', () => {
  const fetchBackup = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    // @ts-ignore
    global.fetch = vi.fn();
    mem.repos = [];
    sendNotificationMock.mockReset();
  });
  afterEach(() => { global.fetch = fetchBackup; });

  it('updates lastSeen and keeps isNew=false on new release', async () => {
    // Existing repo with previously seen tag v1
    mem.repos = [{ id: 'o/r', url: 'https://github.com/o/r', lastSeenReleaseTag: 'v1' }];

    // Mock fetch to return a new release v2
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ([{
        id: 2,
        html_url: '#',
        tag_name: 'v2',
        name: 'v2',
        body: 'x',
        created_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        prerelease: false,
        draft: false,
      }]),
    });

    const { checkForNewReleases } = await import('@/app/actions');
    const res = await checkForNewReleases({ skipCache: true });
    expect(res.notificationsSent).toBe(1);
    expect(mem.repos[0].lastSeenReleaseTag).toBe('v2');
    expect(mem.repos[0].isNew).toBe(false); // no highlight when showAcknowledge=false
  });
});


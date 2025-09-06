// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));

// Stub next/cache to avoid Next runtime specifics
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

// In-memory repository store used by storage mocks
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

const sendNotificationMock = vi.fn();
vi.mock('@/lib/notifications', async (orig) => {
  const actual = await orig();
  return { ...actual, sendNotification: (...args: any[]) => sendNotificationMock(...args) };
});

describe('refreshAndCheckAction', () => {
  beforeEach(() => { vi.resetModules(); });

  // Note: Mocking a function inside the same module isn't reliable with ESM live bindings.
  // We verify the default branch (0 notifications) without stubbing internals.

  it('returns toast_refresh_success_description when no repositories (0 notifications)', async () => {
    mem.repos = [];
    const { refreshAndCheckAction } = await import('@/app/actions');
    const res = await refreshAndCheckAction();
    expect(res.messageKey).toBe('toast_refresh_success_description');
  });

  it('returns toast_refresh_found_new when notificationsSent > 0', async () => {
    const { refreshAndCheckAction } = await import('@/app/actions');
    // Prepare repo with an existing lastSeenReleaseTag so a new tag triggers notification
    mem.repos = [{ id: 'o/r', url: 'https://github.com/o/r', lastSeenReleaseTag: 'v1' }];
    sendNotificationMock.mockResolvedValueOnce(undefined);
    // Mock fetch to return a new release v2
    const fetchBackup = global.fetch;
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
        created_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        prerelease: false,
        draft: false,
      }]),
    });
    const res = await refreshAndCheckAction();
    expect(res.messageKey).toBe('toast_refresh_found_new');
    global.fetch = fetchBackup;
  });
});

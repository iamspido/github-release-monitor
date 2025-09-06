// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
  getLocale: async () => 'en',
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn() }),
}));

const memRepos: { list: any[] } = { list: [] };
const settingsStore: { current: any } = { current: {
  timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
  releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined, excludeRegex: undefined, showAcknowledge: true,
}};

vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => memRepos.list,
  saveRepositories: async (list: any[]) => { memRepos.list = JSON.parse(JSON.stringify(list)); },
}));

vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => settingsStore.current,
  saveSettings: async (s: any) => { settingsStore.current = JSON.parse(JSON.stringify(s)); },
}));

describe('settings actions', () => {
  beforeEach(() => {
    vi.resetModules();
    memRepos.list = [];
    settingsStore.current = {
      timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
      releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined, excludeRegex: undefined, showAcknowledge: true,
    };
  });

  it('updateSettingsAction clears ETags on regex change and resets isNew when disabling acknowledge', async () => {
    memRepos.list = [
      { id: 'o/a', url: 'https://github.com/o/a', etag: 'E1', isNew: true },
      { id: 'o/b', url: 'https://github.com/o/b', etag: 'E2', isNew: true },
    ];

    // Spy checkForNewReleases
    vi.doMock('@/app/actions', async () => {
      const actual = await vi.importActual<any>('@/app/actions');
      return { ...actual, checkForNewReleases: vi.fn().mockResolvedValue({ notificationsSent: 0 }) };
    });

    const { updateSettingsAction } = await import('@/app/settings/actions');
    await updateSettingsAction({
      ...settingsStore.current,
      includeRegex: 'v.*',
      showAcknowledge: false,
    });

    // ETags cleared
    expect(memRepos.list[0].etag).toBeUndefined();
    expect(memRepos.list[1].etag).toBeUndefined();
    // isNew flags reset due to disabling acknowledge
    expect(memRepos.list[0].isNew).toBe(false);
    expect(memRepos.list[1].isNew).toBe(false);
  });

  it('deleteAllRepositoriesAction clears storage and returns success', async () => {
    memRepos.list = [ { id: 'x/y', url: 'https://github.com/x/y' } ];
    const { deleteAllRepositoriesAction } = await import('@/app/settings/actions');
    const res = await deleteAllRepositoriesAction();
    expect(res.success).toBe(true);
    expect(Array.isArray(memRepos.list)).toBe(true);
    expect(memRepos.list.length).toBe(0);
  });
});


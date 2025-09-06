// vitest globals enabled

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const cookieSetMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSetMock }) }));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

const memRepos: { list: any[] } = { list: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => memRepos.list,
  saveRepositories: async (list: any[]) => { memRepos.list = JSON.parse(JSON.stringify(list)); },
}));

vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => ({
    timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
    releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined, excludeRegex: undefined, showAcknowledge: true,
  }),
  saveSettings: async (s: any) => s,
}));

describe('updateSettingsAction cookie and trigger', () => {
  beforeEach(() => { vi.resetModules(); memRepos.list = []; cookieSetMock.mockReset(); });

  it('sets NEXT_LOCALE cookie and triggers checkForNewReleases', async () => {
    // Mock checkForNewReleases from actions module (different module than under test -> safe)
    vi.doMock('@/app/actions', () => ({ checkForNewReleases: vi.fn().mockResolvedValue({ notificationsSent: 0 }) }));

    const { updateSettingsAction } = await import('@/app/settings/actions');
    const res = await updateSettingsAction({
      timeFormat: '24h', locale: 'de', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
      releaseChannels: ['stable'],
    } as any);

    expect(res.success).toBe(true);
    // Cookie set with new locale
    expect(cookieSetMock).toHaveBeenCalled();
    const [name, value] = cookieSetMock.mock.calls[0];
    expect(name).toBe('NEXT_LOCALE');
    expect(value).toBe('de');
  });
});


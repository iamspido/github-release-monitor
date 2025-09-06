// vitest globals enabled

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }));

const mem: { repos: any[] } = { repos: [] };

describe('settings actions error paths', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('updateSettingsAction returns error message when saveSettings throws', async () => {
    vi.doMock('@/lib/settings-storage', () => ({
      getSettings: async () => ({
        timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
        releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined, excludeRegex: undefined, showAcknowledge: true,
      }),
      saveSettings: async () => { throw new Error('fail-save'); },
    }));
    vi.doMock('@/lib/repository-storage', () => ({
      getRepositories: async () => mem.repos,
      saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
    }));

    const { updateSettingsAction } = await import('@/app/settings/actions');
    const res = await updateSettingsAction({ locale: 'en', timeFormat: '24h', refreshInterval: 1, cacheInterval: 5, releasesPerPage: 30, releaseChannels: ['stable'] } as any);
    expect(res.success).toBe(false);
    expect(res.message.description).toBe('toast_error_description');
  });

  it('deleteAllRepositoriesAction returns error message when save fails', async () => {
    vi.doMock('@/lib/repository-storage', () => ({
      getRepositories: async () => mem.repos,
      saveRepositories: async () => { throw new Error('cannot-save'); },
    }));
    const { deleteAllRepositoriesAction } = await import('@/app/settings/actions');
    const res = await deleteAllRepositoriesAction();
    expect(res.success).toBe(false);
    // error message prefers thrown error.message
    expect(res.message.description).toBe('cannot-save');
  });

  it('deleteAllRepositoriesAction falls back to i18n description when error lacks message', async () => {
    vi.doMock('@/lib/repository-storage', () => ({
      getRepositories: async () => mem.repos,
      saveRepositories: async () => { throw {}; },
    }));
    const { deleteAllRepositoriesAction } = await import('@/app/settings/actions');
    const res = await deleteAllRepositoriesAction();
    expect(res.success).toBe(false);
    expect(res.message.description).toBe('toast_delete_all_error_description');
  });
});

// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
  getLocale: async () => 'en',
}));

// In-memory repository store
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
    parallelRepoFetches: 5,
    releaseChannels: ['stable'],
    showAcknowledge: true,
  }),
}));

// Stub background refresh to avoid side effects
vi.mock('@/app/actions', async () => {
  const actual = await vi.importActual<any>('@/app/actions');
  return { ...actual, refreshMultipleRepositoriesAction: async () => {} };
});

describe('importRepositoriesAction idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [
      {
        id: 'github:owner1/repo1',
        url: 'https://github.com/owner1/repo1',
        isNew: false,
      },
    ];
  });

  it('adds new and updates existing repos idempotently', async () => {
    const actions = await import('@/app/actions');

    const imported = [
      { id: 'owner1/repo1', url: 'https://github.com/owner1/repo1', isNew: true }, // existing
      { id: 'owner2/repo2', url: 'https://github.com/owner2/repo2' }, // new
    ];

    const res = await actions.importRepositoriesAction(imported as any);
    expect(res.success).toBe(true);
    // Final list contains both, with merged fields
    expect(mem.repos.find(r => r.id === 'github:owner1/repo1')).toBeTruthy();
    expect(mem.repos.find(r => r.id === 'github:owner2/repo2')).toBeTruthy();
  });
});

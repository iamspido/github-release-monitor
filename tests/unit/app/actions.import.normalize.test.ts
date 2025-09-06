// vitest globals enabled

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

// showAcknowledge=false should normalize imported isNew to false
vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => ({ showAcknowledge: false, locale: 'en' }),
}));

describe('importRepositoriesAction normalization with showAcknowledge=false', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('forces isNew=false on imported data', async () => {
    const { importRepositoriesAction } = await import('@/app/actions');
    const imported = [
      { id: 'o/r', url: 'https://github.com/o/r', isNew: true },
    ];
    const res = await importRepositoriesAction(imported as any);
    expect(res.success).toBe(true);
    expect(mem.repos[0].isNew).toBe(false);
  });
});


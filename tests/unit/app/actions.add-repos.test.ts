// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
  getLocale: async () => 'en',
}));

const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

describe('addRepositoriesAction parses and adds valid URLs', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it('adds only valid GitHub URLs', async () => {
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set('urls', 'https://github.com/owner1/repo1\nhttps://gitlab.com/invalid/x\n  https://github.com/Owner2/Repo2  ');

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(mem.repos.map(r => r.id).sort()).toEqual(['owner1/repo1', 'owner2/repo2']);
  });
});


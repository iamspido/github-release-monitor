// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => key,
  getLocale: async () => 'en',
}));

const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

describe('addRepositoriesAction accepts Codeberg URLs', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it('parses codeberg.org owner/repo and prefixes id', async () => {
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set(
      'urls',
      [
        'https://github.com/owner/repo',
        'https://codeberg.org/Owner/Repo.git',
        'https://codeberg.org/other/repo2',
      ].join('\n'),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    const ids = mem.repos.map((r) => r.id).sort();
    expect(ids).toEqual([
      'codeberg:other/repo2',
      'codeberg:owner/repo',
      'github:owner/repo',
    ]);
    const codeberg = mem.repos.find((r) => r.id === 'codeberg:owner/repo');
    expect(codeberg.url).toBe('https://codeberg.org/Owner/Repo');
  });
});

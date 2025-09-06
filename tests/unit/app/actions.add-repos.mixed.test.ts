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

describe('addRepositoriesAction mixed inputs', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('adds one new, skips duplicate existing, ignores invalid; jobId set for additions', async () => {
    // existing
    mem.repos = [{ id: 'owner/repo', url: 'https://github.com/owner/repo' }];
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set('urls', [
      'https://github.com/owner/repo', // duplicate existing
      'https://example.com/not-github/abc', // invalid domain
      'https://github.com/another/repo', // new valid
    ].join('\n'));

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(typeof res.jobId).toBe('string');
    const ids = mem.repos.map(r => r.id).sort();
    expect(ids).toEqual(['another/repo', 'owner/repo']);
  });

  it('no additions: only invalid/duplicates → no jobId', async () => {
    mem.repos = [{ id: 'owner/repo', url: 'https://github.com/owner/repo' }];
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set('urls', [
      'https://github.com/owner/repo',
      'https://example.com/not-github/abc',
    ].join('\n'));
    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(res.jobId).toBeUndefined();
    expect(mem.repos.length).toBe(1);
  });
});


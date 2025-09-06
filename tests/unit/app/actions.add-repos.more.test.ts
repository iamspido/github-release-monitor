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

describe('addRepositoriesAction edge cases', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('returns error when input is empty or whitespace', async () => {
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set('urls', '   ');
    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_fail_description_manual');
  });

  it('adds parsed repos (duplicates in same batch are kept) and returns a jobId', async () => {
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    // Duplicate of the same repo plus a second one with mixed case and spaces
    fd.set('urls', 'https://github.com/Owner/Repo\nhttps://github.com/owner/repo\n  https://github.com/Another/Repo  ');

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(typeof res.jobId).toBe('string');
    // Saved repos, normalized to lowercase; current implementation does not de-duplicate within one batch
    const ids = mem.repos.map(r => r.id).sort();
    expect(ids).toEqual(['another/repo', 'owner/repo', 'owner/repo']);
  });
});

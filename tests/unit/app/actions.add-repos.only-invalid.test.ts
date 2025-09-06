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

describe('addRepositoriesAction only invalid inputs', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('returns error when all inputs are invalid and no additions are possible', async () => {
    const { addRepositoriesAction } = await import('@/app/actions');
    const fd = new FormData();
    fd.set('urls', [
      'https://example.com/not-github/abc',
      'not a url',
      '   ',
    ].join('\n'));

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_fail_description_manual');
    expect(res).not.toHaveProperty('jobId');
    expect(mem.repos.length).toBe(0);
  });
});


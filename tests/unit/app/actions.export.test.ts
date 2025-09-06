// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

describe('getRepositoriesForExport', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns data on success', async () => {
    await vi.doMock('@/lib/repository-storage', () => ({ getRepositories: async () => ([{ id: 'o/r', url: 'https://github.com/o/r' }]) }));
    const { getRepositoriesForExport } = await import('@/app/actions');
    const res = await getRepositoriesForExport();
    expect(res.success).toBe(true);
    expect(res.data?.length).toBe(1);
  });

  it('returns error when storage throws', async () => {
    vi.resetModules();
    await vi.doMock('@/lib/repository-storage', () => ({ getRepositories: async () => { throw new Error('fail'); } }));
    const { getRepositoriesForExport } = await import('@/app/actions');
    const res = await getRepositoriesForExport();
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});


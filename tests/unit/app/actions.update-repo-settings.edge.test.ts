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

describe('updateRepositorySettingsAction edge cases', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('rejects invalid repo id format', async () => {
    const { updateRepositorySettingsAction } = await import('@/app/actions');
    const res = await updateRepositorySettingsAction('Invalid ID', {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Invalid repository ID format.');
  });

  it('returns not found error when repo does not exist', async () => {
    const { updateRepositorySettingsAction } = await import('@/app/actions');
    const res = await updateRepositorySettingsAction('o/r', { releaseChannels: ['stable'] } as any);
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_error_not_found');
  });
});


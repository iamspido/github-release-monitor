// vitest globals enabled

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

describe('markAsNewAction', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; revalidatePathMock.mockReset(); });

  it('sets isNew=true and revalidates when repo exists', async () => {
    mem.repos = [{ id: 'o/r', url: 'https://github.com/o/r', isNew: false }];
    const { markAsNewAction } = await import('@/app/actions');
    const res = await markAsNewAction('o/r');
    expect(res.success).toBe(true);
    expect(mem.repos[0].isNew).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith('/');
  });

  it('returns not found error when repo missing', async () => {
    const { markAsNewAction } = await import('@/app/actions');
    const res = await markAsNewAction('o/r');
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_mark_as_new_error_not_found');
  });
});


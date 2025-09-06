// vitest globals enabled

const { cacheMocks } = vi.hoisted(() => ({
  cacheMocks: {
    revalidatePath: vi.fn(),
  },
}));

vi.mock('next/cache', () => cacheMocks);

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}));

const mem: { repos: any[] } = { repos: [] };
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
}));

describe('acknowledgeNewReleaseAction', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; cacheMocks.revalidatePath.mockReset?.(); });

  it('sets isNew=false and revalidates when repo exists', async () => {
    mem.repos = [{ id: 'o/r', url: 'https://github.com/o/r', isNew: true }];
    const { acknowledgeNewReleaseAction } = await import('@/app/actions');
    const res = await acknowledgeNewReleaseAction('o/r');
    expect(res.success).toBe(true);
    expect(mem.repos[0].isNew).toBe(false);
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/');
  });

  it('returns not found error when repo missing', async () => {
    const { acknowledgeNewReleaseAction } = await import('@/app/actions');
    const res = await acknowledgeNewReleaseAction('o/r');
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_acknowledge_error_not_found');
  });
});


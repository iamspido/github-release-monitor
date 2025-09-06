// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));

// Cache stubs for revalidation calls
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

// In-memory storage for repositories manipulated by setupTestRepositoryAction
const mem: { repos: any[] } = { repos: [] };
const storage = {
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)); },
};

vi.mock('@/lib/repository-storage', () => storage);

describe('setupTestRepositoryAction', () => {
  beforeEach(() => { vi.resetModules(); mem.repos = []; });

  it('returns success and creates or resets the test repo with cached release', async () => {
    const { setupTestRepositoryAction } = await import('@/app/actions');
    const res = await setupTestRepositoryAction();
    expect(res.success).toBe(true);
    const testRepo = mem.repos.find(r => r.id === 'test/test');
    expect(testRepo).toBeTruthy();
    expect(testRepo.latestRelease).toBeTruthy();
  });

  it('returns failure with message when saving fails', async () => {
    const saveSpy = vi.spyOn(storage, 'saveRepositories').mockRejectedValueOnce(new Error('boom'));
    const { setupTestRepositoryAction } = await import('@/app/actions');
    const res = await setupTestRepositoryAction();
    expect(res.success).toBe(false);
    expect(res.message).toBe('boom');
    saveSpy.mockRestore();
  });

  it('resets existing test repo (reset path)', async () => {
    // Pre-populate with existing test repo
    mem.repos = [{ id: 'test/test', url: 'https://github.com/test/test', lastSeenReleaseTag: 'old', isNew: true }];
    const { setupTestRepositoryAction } = await import('@/app/actions');
    const res = await setupTestRepositoryAction();
    expect(res.success).toBe(true);
    const repo = mem.repos.find(r => r.id === 'test/test');
    expect(repo.lastSeenReleaseTag).toBe('v0.9.0-reset');
    expect(repo.isNew).toBe(false);
    expect(repo.latestRelease).toBeTruthy();
    expect(repo.latestRelease.tag_name).toBe('v0.9.0-reset');
  });
});

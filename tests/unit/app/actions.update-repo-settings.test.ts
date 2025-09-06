// vitest globals enabled

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
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

describe('updateRepositorySettingsAction', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it('updates settings and clears ETag when filters/pagination change', async () => {
    mem.repos = [{
      id: 'o/r', url: 'https://github.com/o/r', etag: 'W/"123"',
      includeRegex: 'old', excludeRegex: 'x', releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], releasesPerPage: 30,
    }];

    const { updateRepositorySettingsAction } = await import('@/app/actions');
    const res = await updateRepositorySettingsAction('o/r', {
      includeRegex: ' new ', // whitespace should be trimmed
      excludeRegex: '', // becomes undefined
      releaseChannels: ['prerelease'],
      preReleaseSubChannels: ['rc'],
      releasesPerPage: 50,
      appriseTags: 'tag',
      appriseFormat: 'html',
    } as any);

    expect(res.success).toBe(true);
    const r = mem.repos[0];
    expect(r.includeRegex).toBe('new');
    expect(r.excludeRegex).toBeUndefined();
    expect(r.releaseChannels).toEqual(['prerelease']);
    expect(r.preReleaseSubChannels).toEqual(['rc']);
    expect(r.releasesPerPage).toBe(50);
    expect(r.appriseTags).toBe('tag');
    expect(r.appriseFormat).toBe('html');
    // etag cleared because of changes
    expect(r.etag).toBeUndefined();
  });

  it('keeps ETag when no relevant changes', async () => {
    mem.repos = [{
      id: 'o/r', url: 'https://github.com/o/r', etag: 'W/"keep"',
      includeRegex: undefined, excludeRegex: undefined, releaseChannels: ['stable'], preReleaseSubChannels: undefined, releasesPerPage: 30,
    }];

    const { updateRepositorySettingsAction } = await import('@/app/actions');
    const res = await updateRepositorySettingsAction('o/r', {
      includeRegex: undefined,
      excludeRegex: undefined,
      releaseChannels: ['stable'],
      preReleaseSubChannels: undefined,
      releasesPerPage: 30,
      appriseTags: undefined,
      appriseFormat: undefined,
    } as any);
    expect(res.success).toBe(true);
    expect(mem.repos[0].etag).toBe('W/"keep"');
  });
});


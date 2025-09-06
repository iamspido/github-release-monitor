// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
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

describe('ETag updates repo on successful fetch', () => {
  const fetchBackup = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    // @ts-ignore
    global.fetch = vi.fn();
  });
  afterEach(() => { global.fetch = fetchBackup; });

  it('sets repo.etag when response includes etag header', async () => {
    const actions = await import('@/app/actions');

    const nowIso = new Date().toISOString();
    // page 1
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: (k: string) => k === 'etag' ? 'W/"123"' : null }, json: async () => ([
      { id: 1, html_url: '#', tag_name: 'v1', name: null, body: 'x', created_at: nowIso, published_at: nowIso, prerelease: false, draft: false },
    ])});

    mem.repos = [ { id: 'o/r', url: 'https://github.com/o/r' } ];

    await actions.checkForNewReleases({ skipCache: true });
    expect(mem.repos[0].etag).toBe('W/"123"');
  });
});


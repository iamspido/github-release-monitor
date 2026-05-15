// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  updateTag: () => {},
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

  it('clears stale releases ETag and updates cached tag fallback releases', async () => {
    const actions = await import('@/app/actions');

    const nowIso = new Date().toISOString();
    // releases empty
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: (k: string) => k === 'etag' ? 'W/"empty-releases"' : null }, json: async () => [] });
    // tags
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ name: 'v2', commit: { sha: 'sha2' } }] });
    // ref to annotated tag? return not annotated
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { type: 'commit', url: 'unused' } }) });
    // commit message
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ commit: { message: 'msg2', committer: { date: nowIso } } }) });

    mem.repos = [{
      id: 'github:zammad/zammad',
      url: 'https://github.com/zammad/zammad',
      etag: 'W/"empty-releases-old"',
      latestRelease: {
        html_url: 'https://github.com/zammad/zammad/releases/tag/v1',
        tag_name: 'v1',
        name: 'Tag: v1',
        body: 'old',
        created_at: nowIso,
        published_at: nowIso,
      },
    }];

    await actions.checkForNewReleases({ skipCache: true });

    expect((global.fetch as any).mock.calls[0][1].headers['If-None-Match']).toBeUndefined();
    expect(mem.repos[0].etag).toBeUndefined();
    expect(mem.repos[0].latestRelease.tag_name).toBe('v2');
    expect(mem.repos[0].latestRelease.source).toBe('tag');
  });
});

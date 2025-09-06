// vitest globals enabled

// Mocks for next/cache to bypass Next runtime
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

// Mock next-intl translations used in tag fallback
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

import type { Repository, AppSettings } from '@/types';

describe('actions fetcher scenarios', () => {
  const fetchBackup = global.fetch;
  const baseSettings: AppSettings = {
    timeFormat: '24h',
    locale: 'en',
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    releaseChannels: ['stable'],
  } as any;

  beforeEach(() => {
    vi.resetModules();
    // @ts-ignore
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it('handles 304 not_modified and reconstructs from cache', async () => {
    const actions = await import('@/app/actions');

    const repo: Repository = {
      id: 'o/r',
      url: 'https://github.com/o/r',
      etag: 'W/"abc"',
      latestRelease: {
        html_url: 'https://github.com/o/r/releases/tag/v1',
        tag_name: 'v1',
        name: 'v1',
        body: 'body',
        created_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    };

    // 304 on first page
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ status: 304, ok: false, headers: { get: () => 'W/"def"' } });

    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].error?.type).toBe('not_modified');
    expect(enriched[0].release?.id).toBe(0); // reconstructed
    expect(enriched[0].release?.tag_name).toBe('v1');
  });

  it('paginates over multiple pages', async () => {
    const actions = await import('@/app/actions');

    const repo: Repository = {
      id: 'o/r',
      url: 'https://github.com/o/r',
      releasesPerPage: 150,
    } as any;

    const now = Date.now();
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      html_url: '#',
      tag_name: `v${i + 1}`,
      name: null,
      body: 'x',
      created_at: new Date(now - (200 - i) * 1000).toISOString(),
      published_at: new Date(now - (200 - i) * 1000).toISOString(),
      prerelease: false,
      draft: false,
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: 100 + i + 1,
      html_url: '#',
      tag_name: `v${100 + i + 1}`,
      name: null,
      body: 'x',
      created_at: new Date(now - (50 - i) * 1000).toISOString(),
      published_at: new Date(now - (50 - i) * 1000).toISOString(),
      prerelease: false,
      draft: false,
    }));

    // page 1
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => page1 });
    // page 2
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => page2 });

    const enriched = await actions.getLatestReleasesForRepos([repo], { ...baseSettings, releasesPerPage: 30 }, 'en', { skipCache: true });
    expect((global.fetch as any).mock.calls.length).toBe(2);
    expect(enriched[0].release?.tag_name).toBe('v150');
  });

  it('falls back to tags when no releases', async () => {
    const actions = await import('@/app/actions');

    const repo: Repository = { id: 'o/r', url: 'https://github.com/o/r' } as any;

    // releases empty
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => [] });
    // tags
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ name: 'v1', commit: { sha: 'sha1' } }] });
    // ref to annotated tag? return not annotated
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { type: 'commit', url: 'unused' } }) });
    // commit message
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ commit: { message: 'msg', committer: { date: new Date().toISOString() } } }) });

    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].release?.id).toBe(0);
    expect(enriched[0].release?.tag_name).toBe('v1');
    expect(enriched[0].error).toBeUndefined();
  });

  it('maps rate_limit and repo_not_found errors', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = { id: 'o/r', url: 'https://github.com/o/r' } as any;

    // rate limit 403
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => '1' } });
    let enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].error?.type).toBe('rate_limit');

    // repo not found 404
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null } });
    enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].error?.type).toBe('repo_not_found');
  });
});


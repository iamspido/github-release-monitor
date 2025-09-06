// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

import type { Repository, AppSettings } from '@/types';

describe('filters: include/exclude/channels/subchannels', () => {
  const fetchBackup = global.fetch;
  const baseSettings: AppSettings = {
    timeFormat: '24h',
    locale: 'en',
    refreshInterval: 10,
    cacheInterval: 0,
    releasesPerPage: 30,
    releaseChannels: ['stable', 'prerelease', 'draft'],
    preReleaseSubChannels: ['beta', 'rc'],
  } as any;

  beforeEach(() => {
    vi.resetModules();
    // @ts-ignore
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it('exclude regex takes precedence over include', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = {
      id: 'o/r',
      url: 'https://github.com/o/r',
      includeRegex: 'v',
      excludeRegex: 'v2',
    } as any;

    // Releases include v1 and v2; exclude should filter out v2
    // @ts-ignore
    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, json: async () => ([
        { id: 1, html_url: '#', tag_name: 'v1', name: null, body: '', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false },
        { id: 2, html_url: '#', tag_name: 'v2', name: null, body: '', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false },
      ])
    });

    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].release?.tag_name).toBe('v1');
  });

  it('invalid regex is ignored (no throw)', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = {
      id: 'o/r', url: 'https://github.com/o/r', includeRegex: '([',
    } as any;
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([
      { id: 1, html_url: '#', tag_name: 'v1', name: null, body: '', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false },
    ])});
    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].release?.tag_name).toBe('v1');
  });

  it('prerelease by tag name matches only configured subchannels', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = { id: 'o/r', url: 'https://github.com/o/r', releaseChannels: ['prerelease'] } as any;
    // two prerelease-like tags by name
    const now = Date.now();
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([
      { id: 1, html_url: '#', tag_name: 'v1.0.0-beta', name: null, body: '', created_at: new Date(now-2000).toISOString(), published_at: new Date(now-2000).toISOString(), prerelease: false, draft: false },
      { id: 2, html_url: '#', tag_name: 'v1.0.0-alpha', name: null, body: '', created_at: new Date(now-1000).toISOString(), published_at: new Date(now-1000).toISOString(), prerelease: false, draft: false },
    ])});

    // Settings allow only beta/rc
    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].release?.tag_name).toBe('v1.0.0-beta');
  });

  it('draft releases included only when channel allows', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = { id: 'o/r', url: 'https://github.com/o/r', releaseChannels: ['draft'] } as any;
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([
      { id: 1, html_url: '#', tag_name: 'v1', name: null, body: '', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: true },
    ])});
    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].release?.tag_name).toBe('v1');
  });

  it('does not match words containing pre-release keyword', async () => {
    const actions = await import('@/app/actions');
    const repo: Repository = { id: 'o/r', url: 'https://github.com/o/r', releaseChannels: ['prerelease'] } as any;
    // betamax should NOT match
    // @ts-ignore
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([
      { id: 1, html_url: '#', tag_name: 'v1-betamax', name: null, body: '', created_at: new Date().toISOString(), published_at: new Date().toISOString(), prerelease: false, draft: false },
    ])});
    const enriched = await actions.getLatestReleasesForRepos([repo], baseSettings, 'en', { skipCache: true });
    expect(enriched[0].error?.type).toBe('no_matching_releases');
  });
});


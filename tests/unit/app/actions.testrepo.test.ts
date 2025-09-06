// vitest globals enabled

vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

import type { AppSettings, Repository } from '@/types';

describe('virtual test repo path produces release with content', () => {
  it('returns a synthetic release for test/test without network', async () => {
    const { getLatestReleasesForRepos } = await import('@/app/actions');
    const repo: Repository = { id: 'test/test', url: 'https://github.com/test/test' } as any;
    const settings: AppSettings = {
      timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 0,
      releasesPerPage: 30, releaseChannels: ['stable'],
    } as any;

    const res = await getLatestReleasesForRepos([repo], settings, 'en', { skipCache: true });
    expect(res[0].release).toBeTruthy();
    expect(res[0].release!.name).toBe('title'); // from mocked translations
    expect(String(res[0].release!.body)).toContain('section_code_blocks');
  });
});


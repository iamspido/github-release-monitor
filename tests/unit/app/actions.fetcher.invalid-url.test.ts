// vitest globals enabled

import type { AppSettings, Repository } from '@/types';

describe('getLatestReleasesForRepos invalid url path', () => {
  it('marks repo with error invalid_url when not github.com', async () => {
    const { getLatestReleasesForRepos } = await import('@/app/actions');
    const repo: Repository = { id: 'e/r', url: 'https://example.com/e/r' } as any;
    const settings: AppSettings = { timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 0, releasesPerPage: 30, releaseChannels: ['stable'] } as any;
    const res = await getLatestReleasesForRepos([repo], settings, 'en', { skipCache: true });
    expect(res[0].error?.type).toBe('invalid_url');
  });
});


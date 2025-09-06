import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = {
  repos: [] as any[],
  settings: {
    timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
    releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined as any, excludeRegex: undefined as any, showAcknowledge: true,
  },
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
  getLocale: async () => 'en',
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }))
vi.mock('@/lib/repository-storage', () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: any[]) => { mem.repos = JSON.parse(JSON.stringify(list)) },
}))
vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => mem.settings,
  saveSettings: async (s: any) => { mem.settings = JSON.parse(JSON.stringify(s)) },
}))

describe('updateSettingsAction trimming does not cause regexChanged and preserves ETags', () => {
  beforeEach(() => {
    vi.resetModules()
    mem.repos = [
      { id: 'a/b', url: 'https://github.com/a/b', etag: 'E1' },
      { id: 'c/d', url: 'https://github.com/c/d', etag: 'E2' },
    ]
    mem.settings = {
      timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
      releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined, excludeRegex: undefined, showAcknowledge: true,
    }
  })

  it('whitespace-only include/exclude keeps undefined and does not clear ETags', async () => {
    const { updateSettingsAction } = await import('@/app/settings/actions')
    await updateSettingsAction({ ...mem.settings, includeRegex: '   ', excludeRegex: '\n\t  ' })
    // unchanged
    expect(mem.settings.includeRegex).toBeUndefined()
    expect(mem.settings.excludeRegex).toBeUndefined()
    // etags preserved
    expect(mem.repos[0].etag).toBe('E1')
    expect(mem.repos[1].etag).toBe('E2')
  })
})


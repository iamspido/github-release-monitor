import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = {
  repos: [] as any[],
  settings: {
    timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releasesPerPage: 30,
    releaseChannels: ['stable'], preReleaseSubChannels: ['beta'], includeRegex: undefined as string | undefined, excludeRegex: undefined as string | undefined, showAcknowledge: true,
  },
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
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

describe('updateSettingsAction clears ETags for all change flags', () => {
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

  async function runAndAssert(newSettings: any) {
    const { updateSettingsAction } = await import('@/app/settings/actions')
    await updateSettingsAction(newSettings)
    expect(mem.repos[0].etag).toBeUndefined()
    expect(mem.repos[1].etag).toBeUndefined()
  }

  it('regexChanged clears ETags', async () => {
    await runAndAssert({ ...mem.settings, includeRegex: '^v' })
  })

  it('channelsChanged clears ETags', async () => {
    await runAndAssert({ ...mem.settings, releaseChannels: ['stable', 'prerelease'] })
  })

  it('preSubsChanged clears ETags', async () => {
    await runAndAssert({ ...mem.settings, preReleaseSubChannels: ['beta', 'rc'] })
  })

  it('rppChanged clears ETags', async () => {
    await runAndAssert({ ...mem.settings, releasesPerPage: 99 })
  })
})


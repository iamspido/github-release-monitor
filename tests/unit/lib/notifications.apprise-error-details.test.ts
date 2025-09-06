import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string, vars?: any) =>
    vars ? `${k}:${vars.status ?? ''}:${vars.details ?? ''}` : k,
}))

const repo = { id: 'o/r', url: 'https://github.com/o/r' } as any
const release = {
  id: 1,
  html_url: '#',
  tag_name: 'v1',
  name: 'v1',
  body: 'x',
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
  prerelease: false,
  draft: false,
} as any

const baseSettings = { timeFormat: '24h', appriseFormat: 'text' } as any

describe('apprise error details', () => {
  const envBackup = { ...process.env }
  const fetchBackup = global.fetch
  beforeEach(() => { process.env = { ...envBackup }; /* @ts-ignore*/ global.fetch = vi.fn() })
  afterEach(() => { process.env = { ...envBackup }; global.fetch = fetchBackup })

  it('throws with status and details when Apprise returns !ok (via sendTestAppriseNotification)', async () => {
    process.env.APPRISE_URL = 'http://apprise.test/notify'
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: false, text: async () => 'bad', status: 503, headers: new Headers() })
    const { sendTestAppriseNotification } = await import('@/lib/notifications')
    await expect(sendTestAppriseNotification(repo, release, 'en', baseSettings)).rejects.toThrow(/503|bad/)
  })
})

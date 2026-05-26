import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('background polling loop', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    process.env = { ...envBackup }
    process.env.NODE_ENV = 'production'
    // ensure no flag blocks init
    delete (global as any).BACKGROUND_POLLING_INITIALIZED

    vi.doMock('@/lib/settings-storage', () => ({ getSettings: async () => ({ refreshInterval: 2 }) }))
    vi.doMock('@/lib/task-scheduler', () => ({ scheduleTask: (_n: string, fn: any) => fn() }))
    vi.doMock('@/lib/repository-storage', () => ({ getRepositories: async () => [], saveRepositories: async () => {} }))
  })

  afterEach(() => { vi.useRealTimers(); process.env = { ...envBackup } })

  it('schedules the next due-check tick after 60000ms', async () => {
    const timeoutSpy = vi.spyOn(global, 'setTimeout')
    await import('@/app/actions')
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.resolve()
    // Background polling wakes every minute and filters repositories by their
    // effective per-repository schedule.
    const delays = timeoutSpy.mock.calls.map(c => c[1])
    expect(delays).toContain(5000)
    expect(delays).toContain(60_000)
    timeoutSpy.mockRestore()
  })
})

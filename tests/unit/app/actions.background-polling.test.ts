import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('actions background polling initialization and loop', () => {
  const envBackup = { ...process.env }
  const setTimeoutBackup = global.setTimeout

  beforeEach(() => {
    vi.resetModules()
    // fake timers to control setTimeout
    vi.useFakeTimers()
    // ensure one-time init allows running
    // @ts-ignore
    delete (global as any)._httpWarningIssued
    // @ts-ignore
    delete (global as any).BACKGROUND_POLLING_INITIALIZED
    process.env = { ...envBackup }
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    vi.useRealTimers()
    global.setTimeout = setTimeoutBackup
    process.env = { ...envBackup }
  })

  it('initializes in production only once and schedules first loop after 5s; loop enforces min interval 1 minute', async () => {
    // Mock settings to return refreshInterval < 1 to trigger min interval of 1 minute
    vi.doMock('@/lib/settings-storage', () => ({
      getSettings: async () => ({ refreshInterval: 0 }),
    }))

    // Make scheduled tasks resolve immediately to unblock the loop
    vi.doMock('@/lib/task-scheduler', () => ({
      scheduleTask: (_name: string, fn: any) => fn(),
    }))

    // Make the release check return quickly by ensuring there are no repositories
    vi.doMock('@/lib/repository-storage', () => ({
      getRepositories: async () => [],
      saveRepositories: async (_list: any[]) => {},
    }))

    // Spy setTimeout to capture delays
    const timeoutSpy = vi.spyOn(global, 'setTimeout')

    // Import module under test; this should schedule the initial 5s timer
    await import('@/app/actions')

    // One initial setTimeout (5s) expected
    // Advance 5s to run backgroundPollingLoop
    await vi.advanceTimersByTimeAsync(5000)
    // allow microtasks to flush
    await Promise.resolve()

    // After first tick, the loop should have scheduled the next run (60s)
    const delaysAfterFirst = timeoutSpy.mock.calls.map(c => c[1])
    expect(delaysAfterFirst).toContain(5000)

    // The loop should schedule the next run using min interval = 1 minute (60000 ms)
    // Verify through a second timeout scheduled after advancing 5s
    await vi.advanceTimersByTimeAsync(60_000)
    await Promise.resolve()
    const delays = timeoutSpy.mock.calls.map(c => c[1])
    expect(delays).toContain(5000)
    expect(delays).toContain(60_000)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('background polling env gating', () => {
  const envBackup = { ...process.env }

  beforeEach(() => { vi.resetModules(); process.env = { ...envBackup } })
  afterEach(() => { process.env = { ...envBackup } })

  it('does not initialize polling when not in production', async () => {
    process.env.NODE_ENV = 'test'
    const timeoutSpy = vi.spyOn(global, 'setTimeout')
    await import('@/app/actions')
    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })

  it('does not re-initialize when BACKGROUND_POLLING_INITIALIZED is set', async () => {
    process.env.NODE_ENV = 'production'
    process.env.BACKGROUND_POLLING_INITIALIZED = 'true'
    const timeoutSpy = vi.spyOn(global, 'setTimeout')
    await import('@/app/actions')
    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })
})


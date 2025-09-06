import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('getSession wrapper', () => {
  const envBackup = { ...process.env }
  beforeEach(() => { vi.resetModules(); process.env.AUTH_SECRET = 'x'.repeat(64) })
  afterEach(() => { process.env = { ...envBackup } })

  it('calls getIronSession with cookies() and returns session', async () => {
    const cookiesMock = vi.fn(async () => ({} as any))
    const sessionObj = { foo: 'bar' }
    const getIronSessionMock = vi.fn(async () => sessionObj)

    vi.doMock('next/headers', () => ({ cookies: cookiesMock }))
    vi.doMock('iron-session', () => ({ getIronSession: getIronSessionMock }))

    const { getSession, sessionOptions } = await import('@/lib/session')
    const result = await getSession()
    expect(getIronSessionMock).toHaveBeenCalledWith(await cookiesMock(), sessionOptions)
    expect(result).toBe(sessionObj)
  })
})


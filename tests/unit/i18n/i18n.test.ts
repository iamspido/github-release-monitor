import { describe, it, expect, vi } from 'vitest'

let capturedGetRequestCb: any

vi.mock('next-intl/server', () => ({
  getRequestConfig: (cb: any) => {
    capturedGetRequestCb = cb
    return {} as any
  },
}))

const notFoundMock = vi.fn(() => {
  throw new Error('notFound')
})

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}))

describe('i18n getRequestConfig callback', () => {
  it('loads EN messages and returns locale', async () => {
    await import('../../../src/i18n')
    const result = await capturedGetRequestCb({ requestLocale: Promise.resolve('en') })
    const en = (await import('../../../src/messages/en.json')).default
    expect(result.locale).toBe('en')
    expect(result.messages).toEqual(en)
  })

  it('loads DE messages and returns locale', async () => {
    // Module already imported; callback captured
    const result = await capturedGetRequestCb({ requestLocale: Promise.resolve('de') })
    const de = (await import('../../../src/messages/de.json')).default
    expect(result.locale).toBe('de')
    expect(result.messages).toEqual(de)
  })

  it('calls notFound for invalid locale', async () => {
    await expect(
      capturedGetRequestCb({ requestLocale: Promise.resolve('fr') })
    ).rejects.toThrowError('notFound')
    expect(notFoundMock).toHaveBeenCalled()
  })
})


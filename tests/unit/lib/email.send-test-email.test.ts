import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock translations
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

// Mock nodemailer
const sendMailMock = vi.fn()
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: sendMailMock }) } }))

import { sendTestEmail } from '@/lib/email'

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

describe('sendTestEmail', () => {
  const envBackup = { ...process.env }
  beforeEach(() => { sendMailMock.mockReset(); process.env = { ...envBackup } })
  afterEach(() => { process.env = { ...envBackup } })

  function primeEnv() {
    process.env.MAIL_HOST = 'smtp.example.com'
    process.env.MAIL_PORT = '465'
    process.env.MAIL_FROM_ADDRESS = 'from@example.com'
    process.env.MAIL_TO_ADDRESS = 'to@example.com'
    process.env.MAIL_USERNAME = 'user'
    process.env.MAIL_PASSWORD = 'pass'
  }

  it('uses explicit toAddress override', async () => {
    primeEnv()
    await sendTestEmail(repo, release, 'en', '24h', 'override@example.com')
    const arg = sendMailMock.mock.calls[0][0]
    expect(arg.to).toBe('override@example.com')
  })

  it('falls back to MAIL_TO_ADDRESS when no override provided', async () => {
    primeEnv()
    await sendTestEmail(repo, release, 'en', '24h')
    const arg = sendMailMock.mock.calls[0][0]
    expect(arg.to).toBe('to@example.com')
  })
})


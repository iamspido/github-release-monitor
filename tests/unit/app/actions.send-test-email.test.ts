// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));

vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => ({ timeFormat: '24h', locale: 'en' }),
}));

// Hoisted mock for email sender
const { mail } = vi.hoisted(() => ({
  mail: {
    sendTestEmail: vi.fn(),
  },
}));

vi.mock('@/lib/email', async (orig) => {
  const actual = await orig();
  return { ...actual, sendTestEmail: (...args: any[]) => mail.sendTestEmail(...args) };
});

describe('sendTestEmailAction', () => {
  const env = { ...process.env };
  beforeEach(() => { vi.resetModules(); process.env = { ...env }; });
  afterEach(() => { process.env = { ...env }; });

  it('returns error when SMTP config incomplete', async () => {
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_FROM_ADDRESS;
    delete process.env.MAIL_TO_ADDRESS;
    const { sendTestEmailAction } = await import('@/app/actions');
    const res = await sendTestEmailAction('');
    expect(res.success).toBe(false);
    expect(res.error).toBe('error_config_incomplete');
  });

  it('returns error on invalid custom email format', async () => {
    process.env.MAIL_HOST = 'smtp';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';

    const { sendTestEmailAction } = await import('@/app/actions');
    const res = await sendTestEmailAction('bad-email');
    expect(res.success).toBe(false);
    expect(res.error).toBe('invalid_email_format');
  });

  it('returns success when sendTestEmail resolves', async () => {
    process.env.MAIL_HOST = 'smtp';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';
    mail.sendTestEmail.mockResolvedValueOnce(undefined);

    const { sendTestEmailAction } = await import('@/app/actions');
    const res = await sendTestEmailAction('');
    expect(res.success).toBe(true);
  });

  it('returns failure error message when sendTestEmail rejects', async () => {
    process.env.MAIL_HOST = 'smtp';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';
    mail.sendTestEmail.mockRejectedValueOnce(new Error('fail-mail'));

    const { sendTestEmailAction } = await import('@/app/actions');
    const res = await sendTestEmailAction('');
    expect(res.success).toBe(false);
    expect(res.error).toBe('fail-mail');
  });
});


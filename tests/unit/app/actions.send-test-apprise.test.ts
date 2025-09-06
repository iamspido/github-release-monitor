// vitest globals enabled

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));

vi.mock('@/lib/settings-storage', () => ({
  getSettings: async () => ({ timeFormat: '24h', locale: 'en' }),
}));

// Hoisted mock for notifications
const { notif } = vi.hoisted(() => ({
  notif: {
    sendTestAppriseNotification: vi.fn(),
  },
}));

vi.mock('@/lib/notifications', async (orig) => {
  const actual = await orig();
  return { ...actual, sendTestAppriseNotification: (...args: any[]) => notif.sendTestAppriseNotification(...args) };
});

describe('sendTestAppriseAction', () => {
  const env = { ...process.env };
  beforeEach(() => { vi.resetModules(); process.env = { ...env }; });
  afterEach(() => { process.env = { ...env }; });

  it('returns error when APPRISE_URL is missing', async () => {
    delete process.env.APPRISE_URL;
    const { sendTestAppriseAction } = await import('@/app/actions');
    const res = await sendTestAppriseAction();
    expect(res.success).toBe(false);
    expect(res.error).toBe('toast_apprise_not_configured_error');
  });

  it('returns success when sendTestAppriseNotification resolves', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    notif.sendTestAppriseNotification.mockResolvedValueOnce(undefined);
    const { sendTestAppriseAction } = await import('@/app/actions');
    const res = await sendTestAppriseAction();
    expect(res.success).toBe(true);
  });

  it('returns failure with message when sendTestAppriseNotification rejects', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    notif.sendTestAppriseNotification.mockRejectedValueOnce(new Error('boom'));
    const { sendTestAppriseAction } = await import('@/app/actions');
    const res = await sendTestAppriseAction();
    expect(res.success).toBe(false);
    expect(res.error).toBe('boom');
  });
});


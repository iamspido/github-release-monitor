// vitest globals are enabled via vitest.config.ts

// Mock translations
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => {
    if (vars && vars.repoId) return `${key}:${vars.repoId}`;
    if (vars && vars.tagName) return `${key}:${vars.tagName}`;
    return key;
  },
}));

// Mock email module to avoid sending real emails; we only ensure it's called
const sendNewReleaseEmailMock = vi.fn();
vi.mock('@/lib/email', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    sendNewReleaseEmail: (...args: any[]) => sendNewReleaseEmailMock(...args),
  };
});

import { sendNotification, sendTestAppriseNotification } from '@/lib/notifications';

const repo = { id: 'owner/repo', url: 'https://github.com/owner/repo' } as any;
const release = {
  id: 1,
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  tag_name: 'v1.0.0',
  name: 'v1',
  body: 'notes',
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
  prerelease: false,
  draft: false,
} as any;

const baseSettings = {
  timeFormat: '24h',
  locale: 'en',
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  releaseChannels: ['stable'],
  appriseMaxCharacters: 0,
} as any;

describe('notifications', () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;

  beforeEach(() => {
    sendNewReleaseEmailMock.mockReset();
    // @ts-ignore
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    global.fetch = fetchBackup;
  });

  it('sendNotification: sends only email when only MAIL_HOST is set', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    await sendNotification(repo, release, 'en', baseSettings);
    expect(sendNewReleaseEmailMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sendNotification: sends only apprise when only APPRISE_URL is set', async () => {
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, text: async () => '', status: 200, headers: new Headers() });
    await sendNotification(repo, release, 'en', baseSettings);
    expect(sendNewReleaseEmailMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sendNotification: both configured, failure of one rejects', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.APPRISE_URL = 'http://apprise.test';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: false, text: async () => 'err', status: 500, headers: new Headers() });
    await expect(sendNotification(repo, release, 'en', baseSettings)).rejects.toThrow(/failed to send/i);
    // email still attempted
    expect(sendNewReleaseEmailMock).toHaveBeenCalled();
  });

  it('sendTestAppriseNotification: missing APPRISE_URL throws', async () => {
    delete process.env.APPRISE_URL;
    await expect(sendTestAppriseNotification(repo, release, 'en', baseSettings)).rejects.toThrow();
  });

  it('sendNotification: repo appriseFormat overrides settings and URL normalization adds /notify', async () => {
    process.env.APPRISE_URL = 'http://apprise.test'; // no /notify
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, text: async () => '', status: 200, headers: new Headers() });

    const settings = { ...baseSettings, appriseFormat: 'html' };
    const repoOverrides = { ...repo, appriseFormat: 'markdown' } as any;
    await sendNotification(repoOverrides, release, 'en', settings);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as any).mock.calls[0];
    const url = call[0] as string;
    const body = JSON.parse(call[1].body);
    expect(url).toMatch(/\/notify$/);
    expect(body.format).toBe('markdown'); // repo override
  });

  it('appriseMaxCharacters truncates text payload', async () => {
    process.env.APPRISE_URL = 'http://apprise.test/notify';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, text: async () => '', status: 200, headers: new Headers() });

    const settings = { ...baseSettings, appriseMaxCharacters: 10, appriseFormat: 'text' };
    await sendNotification(repo, release, 'en', settings);
    const call = (global.fetch as any).mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.body.length).toBeLessThanOrEqual(10);
  });

  it('apprise tags: repo overrides global; global applied when repo absent', async () => {
    process.env.APPRISE_URL = 'http://apprise.test/notify';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, text: async () => '', status: 200, headers: new Headers() });

    // Global tags only
    await sendNotification({ ...repo }, release, 'en', { ...baseSettings, appriseTags: 'g1,g2', appriseFormat: 'text' });
    let call = (global.fetch as any).mock.calls.pop();
    let body = JSON.parse(call[1].body);
    expect(body.tag).toBe('g1,g2');

    // Repo overrides global
    await sendNotification({ ...repo, appriseTags: 'r1' } as any, release, 'en', { ...baseSettings, appriseTags: 'g1,g2', appriseFormat: 'text' });
    call = (global.fetch as any).mock.calls.pop();
    body = JSON.parse(call[1].body);
    expect(body.tag).toBe('r1');
  });

  it('normalizes APPRISE_URL with trailing slashes after /notify', async () => {
    process.env.APPRISE_URL = 'http://apprise.test/notify///';
    // @ts-ignore
    ;(global.fetch as any).mockResolvedValue({ ok: true, text: async () => '', status: 200, headers: new Headers() });

    await sendNotification(repo, release, 'en', { ...baseSettings, appriseFormat: 'text' });
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toBe('http://apprise.test/notify');
  });
});

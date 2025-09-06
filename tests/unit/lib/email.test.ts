// vitest globals are enabled via vitest.config.ts

// Mock translations to simple deterministic strings
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, vars?: Record<string, any>) => {
    // Return key name plus simple vars representation for assertions if needed.
    if (vars && vars.repoId) return `${key}:${vars.repoId}`;
    if (vars && vars.tagName) return `${key}:${vars.tagName}`;
    return key;
  },
}));

// Mock nodemailer transport
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

import { generatePlainTextReleaseBody, generateHtmlReleaseBody, sendNewReleaseEmail, getFormattedDate } from '@/lib/email';

const repo = { id: 'owner/repo', url: 'https://github.com/owner/repo' } as any;
const release = {
  id: 1,
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  tag_name: 'v1.0.0',
  name: 'v1',
  body: null,
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
  prerelease: false,
  draft: false,
} as any;

describe('email', () => {
  const envBackup = { ...process.env };
  beforeEach(() => {
    sendMailMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('generatePlainTextReleaseBody and generateHtmlReleaseBody produce content and fallbacks', async () => {
    const txt = await generatePlainTextReleaseBody(release, repo, 'en', '24h');
    expect(txt).toContain('text_release_notes_label'); // from mocked translations
    expect(txt).toContain(release.tag_name);
    expect(txt).toContain(repo.id);

    const html = await generateHtmlReleaseBody(release, repo, 'en', '24h');
    expect(html).toContain('<html');
    // No notes fallback localized key appears
    expect(html).toContain('html_no_notes');
  });

  it('sendNewReleaseEmail throws on incomplete config', async () => {
    delete process.env.MAIL_HOST;
    await expect(sendNewReleaseEmail(repo, release, 'en', '24h'))
      .rejects.toThrow();
  });

  it('sendNewReleaseEmail calls nodemailer with expected fields when configured', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';
    process.env.MAIL_USERNAME = 'user';
    process.env.MAIL_PASSWORD = 'pass';
    process.env.MAIL_FROM_NAME = 'FromName';

    await sendNewReleaseEmail(repo, { ...release, body: 'notes' }, 'en', '24h');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg).toMatchObject({ to: 'to@example.com' });
    expect(arg.subject).toContain('subject'); // key from mocked translations
    expect(arg.text).toContain('text_release_notes_label');
    expect(arg.html).toContain('<html');
  });

  it('sendNewReleaseEmail throws translated error when transport fails', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';
    process.env.MAIL_USERNAME = 'user';
    process.env.MAIL_PASSWORD = 'pass';
    // make sendMail throw
    sendMailMock.mockRejectedValueOnce(new Error('kaboom'));
    await expect(sendNewReleaseEmail(repo, { ...release }, 'en', '24h')).rejects.toThrow(/error_send_failed/);
  });

  it('sendNewReleaseEmail uses i18n from_name_fallback when MAIL_FROM_NAME is missing', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_FROM_ADDRESS = 'from@example.com';
    process.env.MAIL_TO_ADDRESS = 'to@example.com';
    process.env.MAIL_USERNAME = 'user';
    process.env.MAIL_PASSWORD = 'pass';
    delete process.env.MAIL_FROM_NAME;

    await sendNewReleaseEmail(repo, { ...release, body: 'notes' }, 'en', '24h');
    const arg = sendMailMock.mock.calls[0][0];
    expect(String(arg.from)).toContain('from_name_fallback');
  });

  it('getFormattedDate respects 12h vs 24h and locale', async () => {
    const date = new Date('2024-05-17T13:05:07Z');
    const en12 = await getFormattedDate(date, 'en', '12h');
    const en24 = await getFormattedDate(date, 'en', '24h');
    expect(en12.textDate).not.toBe(en24.textDate);
    const de24 = await getFormattedDate(date, 'de', '24h');
    // Ensure German and English differ in HTML composition
    expect(de24.htmlDate).not.toBe(en24.htmlDate);
  });
});

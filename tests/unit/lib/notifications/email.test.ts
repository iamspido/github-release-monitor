// vitest globals are enabled via vitest.config.ts

// Mock translations to simple deterministic strings
vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, vars?: Record<string, unknown>) => {
      // Return key name plus simple vars representation for assertions if needed.
      if (vars?.repoId) return `${key}:${vars.repoId}`;
      if (vars?.tagName) return `${key}:${vars.tagName}`;
      return key;
    },
}));

// Mock nodemailer transport
const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

import {
  generateHtmlReleaseBody,
  generatePlainTextReleaseBody,
  getFormattedDate,
  sendNewReleaseEmail,
} from "@/lib/notifications/email";
import type { GithubRelease, Repository } from "@/types";

const repo: Repository = {
  id: "owner/repo",
  url: "https://github.com/owner/repo",
};
const release: GithubRelease = {
  id: 1,
  html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
  tag_name: "v1.0.0",
  name: "v1",
  body: null,
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
  prerelease: false,
  draft: false,
};

describe("notifications/email", () => {
  const envBackup = { ...process.env };
  beforeEach(() => {
    sendMailMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("generatePlainTextReleaseBody and generateHtmlReleaseBody produce content and fallbacks", async () => {
    const txt = await generatePlainTextReleaseBody(release, repo, "en", "24h");
    expect(txt).toContain("text_release_notes_label"); // from mocked translations
    expect(txt).toContain(release.tag_name);
    expect(txt).toContain(repo.id);

    const html = await generateHtmlReleaseBody(release, repo, "en", "24h");
    expect(html).toContain("<html");
    // No notes fallback localized key appears
    expect(html).toContain("html_no_notes");
  });

  it("escapes untrusted release and repository fields in HTML output", async () => {
    const maliciousRepo: Repository = {
      id: `owner/<strong onclick="alert(1)">repo</strong>`,
      url: `javascript:alert(1)" data-evil="true`,
    };
    const maliciousRelease: GithubRelease = {
      ...release,
      html_url: `javascript:alert(2)" data-evil="true`,
      tag_name: `v1"><img src=x onerror="alert(3)">`,
      name: `<script>alert(4)</script> & "release"`,
      body: `<script>alert(5)</script><img src=x onerror="alert(6)">`,
    };

    const html = await generateHtmlReleaseBody(
      maliciousRelease,
      maliciousRepo,
      "en",
      "24h",
    );

    expect(html).toContain(
      `owner/&lt;strong onclick=&quot;alert(1)&quot;&gt;repo&lt;/strong&gt;`,
    );
    expect(html).toContain(
      `v1&quot;&gt;&lt;img src=x onerror=&quot;alert(3)&quot;&gt;`,
    );
    expect(html).toContain(
      `&lt;script&gt;alert(4)&lt;/script&gt; &amp; &quot;release&quot;`,
    );
    expect(html).toContain(`href="#"`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data-evil");
  });

  it("sendNewReleaseEmail throws on incomplete config", async () => {
    delete process.env.MAIL_HOST;
    await expect(
      sendNewReleaseEmail(repo, release, "en", "24h"),
    ).rejects.toThrow();
  });

  it("sendNewReleaseEmail calls nodemailer with expected fields when configured", async () => {
    process.env.MAIL_HOST = "smtp.example.com";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.com";
    process.env.MAIL_TO_ADDRESS = "to@example.com";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    process.env.MAIL_FROM_NAME = "FromName";

    await sendNewReleaseEmail(repo, { ...release, body: "notes" }, "en", "24h");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg).toMatchObject({ to: "to@example.com" });
    expect(arg.subject).toContain("subject"); // key from mocked translations
    expect(arg.text).toContain("text_release_notes_label");
    expect(arg.html).toContain("<html");
  });

  it("sendNewReleaseEmail throws translated error when transport fails", async () => {
    process.env.MAIL_HOST = "smtp.example.com";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.com";
    process.env.MAIL_TO_ADDRESS = "to@example.com";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    // make sendMail throw
    sendMailMock.mockRejectedValueOnce(new Error("kaboom"));
    await expect(
      sendNewReleaseEmail(repo, { ...release }, "en", "24h"),
    ).rejects.toThrow(/error_send_failed/);
  });

  it("sendNewReleaseEmail uses i18n from_name_fallback when MAIL_FROM_NAME is missing", async () => {
    process.env.MAIL_HOST = "smtp.example.com";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.com";
    process.env.MAIL_TO_ADDRESS = "to@example.com";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    delete process.env.MAIL_FROM_NAME;

    await sendNewReleaseEmail(repo, { ...release, body: "notes" }, "en", "24h");
    const arg = sendMailMock.mock.calls[0][0];
    expect(String(arg.from)).toContain("from_name_fallback");
  });

  it("getFormattedDate respects 12h vs 24h and locale", async () => {
    const date = new Date("2024-05-17T13:05:07Z");
    const en12 = await getFormattedDate(date, "en", "12h");
    const en24 = await getFormattedDate(date, "en", "24h");
    expect(en12.textDate).not.toBe(en24.textDate);
    const de24 = await getFormattedDate(date, "de", "24h");
    // Ensure German and English differ in HTML composition
    expect(de24.htmlDate).not.toBe(en24.htmlDate);
  });
});

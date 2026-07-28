// vitest globals are enabled via vitest.config.ts

// Mock translations to simple deterministic strings
vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, vars?: Record<string, unknown>) => {
      // Return key name plus simple vars representation for assertions if needed.
      if (key === "html_intro" && vars?.repoId) {
        return `${vars.repoId} and ${vars.repoId}`;
      }
      if (vars?.repoId && vars?.tagName) {
        return `${key}:${vars.repoId}:${vars.tagName}`;
      }
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
    expect(txt).toContain(`\u2066${release.tag_name}\u2069`);
    expect(txt).toContain(`\u2066${repo.id}\u2069`);

    const html = await generateHtmlReleaseBody(release, repo, "en", "24h");
    expect(html).toContain("<html");
    expect(html).toContain('<html lang="en" dir="ltr">');
    // No notes fallback localized key appears
    expect(html).toContain("html_no_notes");
  });

  it("renders Arabic email direction, bidi isolation, and RTL spacing", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "ar", "24h");

    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('html[dir="rtl"] .details-list');
    expect(html).toContain('html[dir="rtl"] blockquote');
    expect(html).toContain(
      `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${release.tag_name}</bdi>`,
    );
    expect(html).toContain(
      `<bdi dir="ltr" style="direction: ltr; unicode-bidi: isolate;">${repo.id}</bdi>`,
    );
    expect(html).toContain(
      `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${repo.id}</bdi>`,
    );
    expect(html).toContain(
      `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${release.tag_name}</bdi>`,
    );
  });

  it("renders Brazilian Portuguese email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "pt-BR", "24h");

    expect(html).toContain('<html lang="pt-BR" dir="ltr">');
  });

  it("renders Indonesian email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "id", "24h");

    expect(html).toContain('<html lang="id" dir="ltr">');
  });

  it("renders Hindi email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "hi", "24h");

    expect(html).toContain('<html lang="hi" dir="ltr">');
  });

  it("renders Simplified Chinese email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "zh-CN", "24h");

    expect(html).toContain('<html lang="zh-CN" dir="ltr">');
  });

  it("renders Japanese email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "ja", "24h");

    expect(html).toContain('<html lang="ja" dir="ltr">');
  });

  it("replaces every repository placeholder in a translated HTML intro", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "en", "24h");

    expect(
      html.match(
        /href="https:\/\/github\.com\/owner\/repo" style="color: #8c9fe8/g,
      ),
    ).toHaveLength(2);
    expect(html).not.toContain("REPO_PLACEHOLDER");
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
    process.env.MAIL_HOST = "smtp.example.test";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.test";
    process.env.MAIL_TO_ADDRESS = "to@example.test";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    process.env.MAIL_FROM_NAME = "FromName";

    await sendNewReleaseEmail(repo, { ...release, body: "notes" }, "en", "24h");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg).toMatchObject({ to: "to@example.test" });
    expect(arg.subject).toContain("subject"); // key from mocked translations
    expect(arg.subject).toContain(`\u2066${repo.id}\u2069`);
    expect(arg.subject).toContain(`\u2066${release.tag_name}\u2069`);
    expect(arg.text).toContain("text_release_notes_label");
    expect(arg.html).toContain("<html");
  });

  it("sendNewReleaseEmail throws translated error when transport fails", async () => {
    process.env.MAIL_HOST = "smtp.example.test";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.test";
    process.env.MAIL_TO_ADDRESS = "to@example.test";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    // make sendMail throw
    sendMailMock.mockRejectedValueOnce(new Error("kaboom"));
    await expect(
      sendNewReleaseEmail(repo, { ...release }, "en", "24h"),
    ).rejects.toThrow(/error_send_failed/);
  });

  it("sendNewReleaseEmail uses i18n from_name_fallback when MAIL_FROM_NAME is missing", async () => {
    process.env.MAIL_HOST = "smtp.example.test";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.test";
    process.env.MAIL_TO_ADDRESS = "to@example.test";
    process.env.MAIL_USERNAME = "user";
    process.env.MAIL_PASSWORD = "pass";
    delete process.env.MAIL_FROM_NAME;

    await sendNewReleaseEmail(repo, { ...release, body: "notes" }, "en", "24h");
    const arg = sendMailMock.mock.calls[0][0];
    expect(String(arg.from)).toContain("from_name_fallback");
  });

  it("getFormattedDate respects 12h vs 24h and locale", async () => {
    process.env.TZ = "UTC";
    const date = new Date("2024-05-17T13:05:07Z");
    const en12 = await getFormattedDate(date, "en", "12h");
    const en24 = await getFormattedDate(date, "en", "24h");
    expect(en12.textDate).not.toBe(en24.textDate);
    const de24 = await getFormattedDate(date, "de", "24h");
    // Ensure German and English differ in HTML composition
    expect(de24.htmlDate).not.toBe(en24.htmlDate);
    const ptBR12 = await getFormattedDate(date, "pt-BR", "12h");
    const ptBR24 = await getFormattedDate(date, "pt-BR", "24h");
    expect(ptBR12.textDate).toMatch(/[ap]\.?\s*m\.?/iu);
    expect(ptBR24.textDate).not.toMatch(/[ap]\.?\s*m\.?/iu);
    expect(ptBR12.textDate).not.toBe(ptBR24.textDate);
    const id12 = await getFormattedDate(date, "id", "12h");
    const id24 = await getFormattedDate(date, "id", "24h");
    expect(id12.textDate).toMatch(/AM|PM/iu);
    expect(id24.textDate).not.toMatch(/AM|PM/iu);
    expect(id12.textDate).not.toBe(id24.textDate);
    const hi12 = await getFormattedDate(date, "hi", "12h");
    const hi24 = await getFormattedDate(date, "hi", "24h");
    expect(hi12.textDate).toMatch(/AM|PM/iu);
    expect(hi24.textDate).not.toMatch(/AM|PM/iu);
    expect(hi12.textDate).not.toBe(hi24.textDate);
    const zhCN12 = await getFormattedDate(date, "zh-CN", "12h");
    const zhCN24 = await getFormattedDate(date, "zh-CN", "24h");
    expect(zhCN12.textDate).toMatch(/上午|下午/u);
    expect(zhCN24.textDate).not.toMatch(/上午|下午/u);
    expect(zhCN12.textDate).not.toBe(zhCN24.textDate);
    const ja12 = await getFormattedDate(date, "ja", "12h");
    const ja24 = await getFormattedDate(date, "ja", "24h");
    expect(ja12.textDate).toMatch(/午前|午後/u);
    expect(ja24.textDate).not.toMatch(/午前|午後/u);
    expect(ja12.textDate).not.toBe(ja24.textDate);
    const ar12 = await getFormattedDate(date, "ar", "12h");
    const ar24 = await getFormattedDate(date, "ar", "24h");
    expect(ar12.htmlDate).toMatch(/[\u0600-\u06ff]/u);
    expect(ar12.textDate).not.toBe(ar24.textDate);
    expect(ar24.textDate).not.toMatch(/(?:^|\s)[صم](?:\s|$)/u);
  });

  it("getFormattedDate uses the configured server timezone and daylight saving time", async () => {
    process.env.TZ = "Europe/Berlin";

    const winter = await getFormattedDate(
      new Date("2024-01-15T12:05:07Z"),
      "en",
      "24h",
    );
    const summer = await getFormattedDate(
      new Date("2024-07-15T12:05:07Z"),
      "en",
      "24h",
    );

    expect(winter.textDate).toContain("13:05");
    expect(summer.textDate).toContain("14:05");
    expect(winter.textDate).not.toMatch(/AM|PM/i);
  });

  it.each([undefined, "Invalid/Timezone"])(
    "getFormattedDate falls back safely when TZ is %s",
    async (timeZone) => {
      if (timeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = timeZone;
      }

      await expect(
        getFormattedDate(new Date("2024-05-17T13:05:07Z"), "en", "24h"),
      ).resolves.toEqual({
        textDate: expect.any(String),
        htmlDate: expect.any(String),
      });
    },
  );
});

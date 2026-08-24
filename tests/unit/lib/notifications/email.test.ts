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
  generateHtmlReleaseDigestBody,
  generatePlainTextReleaseBody,
  generatePlainTextReleaseDigestBody,
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

  it("omits release notes from both email alternatives when disabled", async () => {
    const releaseWithNotes = { ...release, body: "private release details" };
    const text = await generatePlainTextReleaseBody(
      releaseWithNotes,
      repo,
      "en",
      "24h",
      false,
    );
    const html = await generateHtmlReleaseBody(
      releaseWithNotes,
      repo,
      "en",
      "24h",
      false,
    );

    expect(text).not.toContain("private release details");
    expect(text).not.toContain("text_release_notes_label");
    expect(text).toContain(release.html_url);
    expect(html).not.toContain("private release details");
    expect(html).not.toContain("html_notes_title");
    expect(html).toContain(release.html_url);
  });

  it("renders multiple releases in safe text and HTML digests", async () => {
    const maliciousRepository: Repository = {
      id: "owner/<script>alert(1)</script>",
      url: "javascript:alert(1)",
    };
    const items = [
      { repository: repo, release },
      {
        repository: maliciousRepository,
        release: {
          ...release,
          tag_name: "v2<script>",
          html_url: "javascript:alert(2)",
          body: "private digest notes",
        },
      },
    ];

    const text = await generatePlainTextReleaseDigestBody(
      items,
      "en",
      "24h",
      false,
    );
    const html = await generateHtmlReleaseDigestBody(items, "ar", "24h", true);

    expect(text).toContain(repo.id);
    expect(text).toContain(maliciousRepository.id);
    expect(text).not.toContain("private digest notes");
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("owner/&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("private digest notes");
  });

  it("adds the localized release monitor link to both email alternatives", async () => {
    process.env.BETTER_AUTH_URL = "https://monitor.example/base?old=1#old";

    const text = await generatePlainTextReleaseBody(release, repo, "de", "24h");
    const html = await generateHtmlReleaseBody(release, repo, "de", "24h");

    expect(text).toContain("view_monitor_label");
    expect(text).toContain("https://monitor.example/de");
    expect(html).toContain("view_monitor_label");
    expect(html).toContain('href="https://monitor.example/de"');
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

  it("renders Hebrew email direction, bidi isolation, and RTL spacing", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "he", "24h");

    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('html[dir="rtl"] .details-list');
    expect(html).toContain('html[dir="rtl"] blockquote');
    expect(html).toContain(
      `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${release.tag_name}</bdi>`,
    );
    expect(html).toContain(
      `<bdi dir="ltr" style="direction: ltr; unicode-bidi: isolate;">${repo.id}</bdi>`,
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

  it("renders Korean email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "ko", "24h");

    expect(html).toContain('<html lang="ko" dir="ltr">');
  });

  it("renders Turkish email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "tr", "24h");

    expect(html).toContain('<html lang="tr" dir="ltr">');
  });

  it("renders Vietnamese email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "vi", "24h");

    expect(html).toContain('<html lang="vi" dir="ltr">');
  });

  it("renders Italian email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "it", "24h");

    expect(html).toContain('<html lang="it" dir="ltr">');
  });

  it("renders Polish email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "pl", "24h");

    expect(html).toContain('<html lang="pl" dir="ltr">');
  });

  it("renders Ukrainian email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "uk", "24h");

    expect(html).toContain('<html lang="uk" dir="ltr">');
  });

  it("renders Dutch email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "nl", "24h");

    expect(html).toContain('<html lang="nl" dir="ltr">');
  });

  it("renders Russian email metadata as left-to-right", async () => {
    const html = await generateHtmlReleaseBody(release, repo, "ru", "24h");

    expect(html).toContain('<html lang="ru" dir="ltr">');
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
    const ko12 = await getFormattedDate(date, "ko", "12h");
    const ko24 = await getFormattedDate(date, "ko", "24h");
    expect(ko12.textDate).toMatch(/오전|오후/u);
    expect(ko24.textDate).not.toMatch(/오전|오후/u);
    expect(ko12.textDate).not.toBe(ko24.textDate);
    const tr12 = await getFormattedDate(date, "tr", "12h");
    const tr24 = await getFormattedDate(date, "tr", "24h");
    expect(tr12.textDate).toMatch(/ÖÖ|ÖS/u);
    expect(tr24.textDate).not.toMatch(/ÖÖ|ÖS/u);
    expect(tr12.textDate).not.toBe(tr24.textDate);
    const vi12 = await getFormattedDate(date, "vi", "12h");
    const vi24 = await getFormattedDate(date, "vi", "24h");
    expect(vi12.textDate).toMatch(/SA|CH/u);
    expect(vi24.textDate).not.toMatch(/SA|CH/u);
    expect(vi12.textDate).not.toBe(vi24.textDate);
    const it12 = await getFormattedDate(date, "it", "12h");
    const it24 = await getFormattedDate(date, "it", "24h");
    expect(it12.textDate).toMatch(/AM|PM/u);
    expect(it24.textDate).not.toMatch(/AM|PM/u);
    expect(it12.textDate).not.toBe(it24.textDate);
    const pl12 = await getFormattedDate(date, "pl", "12h");
    const pl24 = await getFormattedDate(date, "pl", "24h");
    expect(pl12.textDate).toMatch(/AM|PM/u);
    expect(pl24.textDate).not.toMatch(/AM|PM/u);
    expect(pl12.textDate).not.toBe(pl24.textDate);
    const uk12 = await getFormattedDate(date, "uk", "12h");
    const uk24 = await getFormattedDate(date, "uk", "24h");
    expect(uk12.textDate).toMatch(/дп|пп/iu);
    expect(uk24.textDate).not.toMatch(/дп|пп/iu);
    expect(uk12.textDate).not.toBe(uk24.textDate);
    const nl12 = await getFormattedDate(date, "nl", "12h");
    const nl24 = await getFormattedDate(date, "nl", "24h");
    expect(nl12.textDate).toMatch(/[ap]\.?\s*m\.?/iu);
    expect(nl24.textDate).not.toMatch(/[ap]\.?\s*m\.?/iu);
    expect(nl12.textDate).not.toBe(nl24.textDate);
    const ru12 = await getFormattedDate(date, "ru", "12h");
    const ru24 = await getFormattedDate(date, "ru", "24h");
    expect(ru12.textDate).toMatch(/AM|PM/iu);
    expect(ru24.textDate).not.toMatch(/AM|PM/iu);
    expect(ru12.textDate).not.toBe(ru24.textDate);
    const he12 = await getFormattedDate(date, "he", "12h");
    const he24 = await getFormattedDate(date, "he", "24h");
    expect(he12.htmlDate).toMatch(/\p{Script=Hebrew}/u);
    expect(he12.textDate).toMatch(/לפנה״צ|אחה״צ|AM|PM/u);
    expect(he24.textDate).not.toMatch(/לפנה״צ|אחה״צ|AM|PM/u);
    expect(he12.textDate).not.toBe(he24.textDate);
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

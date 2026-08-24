// vitest globals are enabled via vitest.config.ts

const { sendNewReleaseEmailMock } = vi.hoisted(() => ({
  sendNewReleaseEmailMock: vi.fn(),
}));

// Mock translations
vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, vars?: Record<string, unknown>) => {
      if (key === "text_new_version_of_markdown") {
        return `A new version of ${vars?.repoId ?? ""} has been released.`;
      }
      if (key === "view_on_github_link" && vars?.link) {
        return `[View release](${vars.link})`;
      }
      if (vars?.repoId) return `${key}:${vars.repoId}`;
      if (vars?.tagName) return `${key}:${vars.tagName}`;
      return key;
    },
}));

// Mock email module to avoid sending real emails; we only ensure it's called
vi.mock("@/lib/notifications/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications/email")>();
  return {
    ...actual,
    sendNewReleaseEmail: sendNewReleaseEmailMock,
  };
});

import {
  getConfiguredNotificationChannels,
  sendNotification,
  sendTestAppriseNotification,
} from "@/lib/notifications";
import {
  normalizeMarkdownReleaseNotes,
  sendAppriseDigest,
} from "@/lib/notifications/apprise";
import type { AppSettings, GithubRelease, Repository } from "@/types";
import {
  fetchCallBodyText,
  installFetchMock,
  mockFetchResponse,
} from "../../helpers/fetch";

const repo: Repository = {
  id: "owner/repo",
  url: "https://github.com/owner/repo",
};
const release: GithubRelease = {
  id: 1,
  html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
  tag_name: "v1.0.0",
  name: "v1",
  body: "notes",
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
  prerelease: false,
  draft: false,
};

const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 5,
  releaseChannels: ["stable"],
  appriseMaxCharacters: 0,
};

describe("notifications/index", () => {
  const envBackup = { ...process.env };
  const fetchBackup = global.fetch;

  beforeEach(() => {
    sendNewReleaseEmailMock.mockReset();
    installFetchMock();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    global.fetch = fetchBackup;
  });

  it("sendNotification: sends email when SMTP is fully configured", async () => {
    process.env.MAIL_HOST = "smtp.example.test";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.test";
    process.env.MAIL_TO_ADDRESS = "to@example.test";
    await sendNotification(repo, release, "en", baseSettings);
    expect(sendNewReleaseEmailMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not select email when the SMTP configuration is incomplete", () => {
    process.env.MAIL_HOST = "smtp.example.test";
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_FROM_ADDRESS;
    delete process.env.MAIL_TO_ADDRESS;
    delete process.env.APPRISE_URL;

    expect(getConfiguredNotificationChannels()).toEqual([]);
  });

  it.each(["invalid", "587suffix", "0", "65536", "-1", "5.5"])(
    "does not select email when MAIL_PORT is %s",
    (port) => {
      process.env.MAIL_HOST = "smtp.example.test";
      process.env.MAIL_PORT = port;
      process.env.MAIL_FROM_ADDRESS = "from@example.test";
      process.env.MAIL_TO_ADDRESS = "to@example.test";
      delete process.env.APPRISE_URL;

      expect(getConfiguredNotificationChannels()).toEqual([]);
    },
  );

  it("sendNotification: sends only apprise when only APPRISE_URL is set", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    await sendNotification(repo, release, "en", baseSettings);
    expect(sendNewReleaseEmailMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sendNotification: both configured, failure of one rejects", async () => {
    process.env.MAIL_HOST = "smtp.example.test";
    process.env.MAIL_PORT = "587";
    process.env.MAIL_FROM_ADDRESS = "from@example.test";
    process.env.MAIL_TO_ADDRESS = "to@example.test";
    process.env.APPRISE_URL = "http://apprise.test";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 500, text: "err" }),
    );
    await expect(
      sendNotification(repo, release, "en", baseSettings),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/failed to send/i),
      failedChannels: ["apprise"],
    });
    // email still attempted
    expect(sendNewReleaseEmailMock).toHaveBeenCalled();
  });

  it("sendTestAppriseNotification: missing APPRISE_URL throws", async () => {
    delete process.env.APPRISE_URL;
    await expect(
      sendTestAppriseNotification(repo, release, "en", baseSettings),
    ).rejects.toThrow();
  });

  it("sendNotification: repo appriseFormat overrides settings and URL normalization adds /notify", async () => {
    process.env.APPRISE_URL = "http://apprise.test"; // no /notify
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    const settings: AppSettings = { ...baseSettings, appriseFormat: "html" };
    const repoOverrides: Repository = { ...repo, appriseFormat: "markdown" };
    await sendNotification(repoOverrides, release, "en", settings);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(global.fetch).mock.calls[0];
    const url = call[0] as string;
    const body = JSON.parse(fetchCallBodyText(call));
    expect(url).toMatch(/\/notify$/);
    expect(body.format).toBe("markdown"); // repo override
    expect(body.body).toContain(
      "**[owner/repo](https://github.com/owner/repo)**",
    );
    expect(body.body).not.toContain("REPO_PLACEHOLDER");
  });

  it("escapes Apprise markdown metadata and unsafe link destinations", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    const maliciousRepo: Repository = {
      id: "owner](https://evil.test)<b>",
      url: "javascript:alert(1)",
      appriseFormat: "markdown",
    };
    const maliciousRelease: GithubRelease = {
      ...release,
      html_url: "javascript:alert(2)",
      tag_name: "v1](https://evil.test)",
      name: "Name **bold** [x](https://evil.test)",
    };

    await sendNotification(maliciousRepo, maliciousRelease, "en", baseSettings);

    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(fetchCallBodyText(call));
    expect(payload.format).toBe("markdown");
    expect(payload.body).toContain("owner\\]\\(https://evil\\.test\\)\\<b\\>");
    expect(payload.body).toContain("v1\\]\\(https://evil\\.test\\)");
    expect(payload.body).toContain(
      "Name \\*\\*bold\\*\\* \\[x\\]\\(https://evil\\.test\\)",
    );
    expect(payload.body).toContain("](#)");
    expect(payload.body).not.toContain("javascript:");
    expect(payload.body).not.toContain("Name **bold** [x]");
  });

  it("appriseMaxCharacters truncates text payload", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    const settings: AppSettings = {
      ...baseSettings,
      appriseMaxCharacters: 500,
      appriseFormat: "text",
    };
    await sendNotification(
      repo,
      { ...release, body: "x".repeat(2_000) },
      "en",
      settings,
    );
    const call = vi.mocked(global.fetch).mock.calls[0];
    const payload = JSON.parse(fetchCallBodyText(call));
    expect(payload.body.length).toBeLessThanOrEqual(500);
    expect(payload.body).toContain(release.html_url);
    expect(payload.body).toContain("http://localhost:3000/en");
  });

  it.each(["text", "markdown", "html"] as const)(
    "omits release notes from %s Apprise messages when disabled",
    async (appriseFormat) => {
      process.env.APPRISE_URL = "http://apprise.test/notify";
      process.env.BETTER_AUTH_URL = "https://monitor.example/base";
      vi.mocked(global.fetch).mockResolvedValue(
        mockFetchResponse({ status: 200, text: "" }),
      );

      const releaseWithNotes = {
        ...release,
        body: "private release details",
      };
      await sendNotification(repo, releaseWithNotes, "en", {
        ...baseSettings,
        appriseFormat,
        appriseIncludeReleaseNotes: false,
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCallBodyText(call));
      expect(payload.body).not.toContain("private release details");
      expect(payload.body).toContain(release.html_url);
      expect(payload.body).toContain("https://monitor.example/en");
    },
  );

  it.each(["text", "markdown"] as const)(
    "never exceeds a very small %s Apprise message limit",
    async (appriseFormat) => {
      process.env.APPRISE_URL = "http://apprise.test/notify";
      process.env.BETTER_AUTH_URL = "https://monitor.example";
      vi.mocked(global.fetch).mockResolvedValue(
        mockFetchResponse({ status: 200, text: "" }),
      );

      await sendNotification(repo, release, "en", {
        ...baseSettings,
        appriseFormat,
        appriseMaxCharacters: 1,
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCallBodyText(call));
      expect(payload.body.length).toBeLessThanOrEqual(1);
    },
  );

  it.each(["text", "markdown"] as const)(
    "prioritizes the release link when only one link fits in a %s Apprise message",
    async (appriseFormat) => {
      process.env.APPRISE_URL = "http://apprise.test/notify";
      process.env.BETTER_AUTH_URL = "https://monitor.example";
      vi.mocked(global.fetch).mockResolvedValue(
        mockFetchResponse({ status: 200, text: "" }),
      );

      await sendNotification(repo, release, "en", {
        ...baseSettings,
        appriseFormat,
        appriseMaxCharacters: 90,
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCallBodyText(call));
      expect(payload.body.length).toBeLessThanOrEqual(90);
      expect(payload.body).toContain(release.html_url);
      expect(payload.body).not.toContain("https://monitor.example/en");
    },
  );

  it.each(["text", "markdown"] as const)(
    "uses the monitor link when the release link does not fit in a %s Apprise message",
    async (appriseFormat) => {
      process.env.APPRISE_URL = "http://apprise.test/notify";
      process.env.BETTER_AUTH_URL = "https://monitor.example";
      vi.mocked(global.fetch).mockResolvedValue(
        mockFetchResponse({ status: 200, text: "" }),
      );
      const oversizedRelease = {
        ...release,
        html_url: `https://github.com/${"x".repeat(200)}`,
      };

      await sendNotification(repo, oversizedRelease, "en", {
        ...baseSettings,
        appriseFormat,
        appriseMaxCharacters: 90,
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCallBodyText(call));
      expect(payload.body.length).toBeLessThanOrEqual(90);
      expect(payload.body).not.toContain(oversizedRelease.html_url);
      expect(payload.body).toContain("https://monitor.example/en");
    },
  );

  it("forwards the email release-notes setting independently", async () => {
    await sendNotification(
      repo,
      release,
      "en",
      { ...baseSettings, emailIncludeReleaseNotes: false },
      ["email"],
    );

    expect(sendNewReleaseEmailMock).toHaveBeenCalledWith(
      repo,
      release,
      "en",
      "24h",
      undefined,
      false,
    );
  });

  it("apprise tags: repo overrides global; global applied when repo absent", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    const globalTagsSettings: AppSettings = {
      ...baseSettings,
      appriseTags: "g1,g2",
      appriseFormat: "text",
    };
    await sendNotification({ ...repo }, release, "en", globalTagsSettings);
    let call = vi.mocked(global.fetch).mock.calls.pop();
    if (!call) {
      throw new Error("Expected Apprise fetch call");
    }
    let body = JSON.parse(fetchCallBodyText(call));
    expect(body.tag).toBe("g1,g2");

    // Repo overrides global
    const repoTagsSettings: AppSettings = {
      ...baseSettings,
      appriseTags: "g1,g2",
      appriseFormat: "text",
    };
    await sendNotification(
      { ...repo, appriseTags: "r1" },
      release,
      "en",
      repoTagsSettings,
    );
    call = vi.mocked(global.fetch).mock.calls.pop();
    if (!call) {
      throw new Error("Expected Apprise fetch call");
    }
    body = JSON.parse(fetchCallBodyText(call));
    expect(body.tag).toBe("r1");
  });

  it("normalizes APPRISE_URL with trailing slashes after /notify", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify///";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    const settings: AppSettings = {
      ...baseSettings,
      appriseFormat: "text",
    };
    await sendNotification(repo, release, "en", settings);
    const [call] = vi.mocked(global.fetch).mock.calls;
    if (!call) {
      throw new Error("Expected Apprise fetch call");
    }
    const url = call[0] as string;
    expect(url).toBe("http://apprise.test/notify");
  });

  it("truncates an Apprise digest at complete release boundaries", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    process.env.BETTER_AUTH_URL = "https://monitor.example";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    const items = Array.from({ length: 8 }, (_, index) => ({
      repository: {
        id: `owner/repository-${index}`,
        url: `https://github.com/owner/repository-${index}`,
      },
      release: {
        ...release,
        tag_name: `v${index}`,
        html_url: `https://github.com/owner/repository-${index}/releases/v${index}`,
        body: "x".repeat(300),
      },
    }));

    await sendAppriseDigest(
      items,
      "en",
      {
        ...baseSettings,
        appriseFormat: "markdown",
        appriseMaxCharacters: 500,
      },
      { format: "markdown" },
    );

    const payload = JSON.parse(
      fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
    );
    expect(payload.body.length).toBeLessThanOrEqual(500);
    expect(payload.body).toContain("digest_omitted");
    expect(payload.body).not.toMatch(/x{100}/);
    expect(payload.body).toContain("https://monitor.example/en");
  });

  it("omits the monitor link instead of truncating it in a digest", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    process.env.BETTER_AUTH_URL = "https://monitor.example";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    const items = Array.from({ length: 2 }, (_, index) => ({
      repository: {
        id: `owner/repository-${index}`,
        url: `https://github.com/owner/repository-${index}`,
      },
      release: {
        ...release,
        tag_name: `v${index}`,
        html_url: `https://github.com/owner/repository-${index}/releases/v${index}`,
        body: "x".repeat(300),
      },
    }));

    await sendAppriseDigest(
      items,
      "en",
      {
        ...baseSettings,
        appriseFormat: "text",
        appriseMaxCharacters: 60,
      },
      { format: "text" },
    );

    const payload = JSON.parse(
      fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
    );
    expect(payload.body.length).toBeLessThanOrEqual(60);
    expect(payload.body).toContain("digest_omitted");
    expect(payload.body).not.toContain("https://monitor.example");
    expect(payload.body).not.toContain("https://mon");
  });

  it("normalizes Markdown release notes without leaking blocks into later entries", async () => {
    const unsafeControl = "\u202e";
    const normalized = normalizeMarkdownReleaseNotes(
      `${unsafeControl}<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n\`\`\`js\nconst value = 1;`,
    );

    expect(normalized).not.toContain(unsafeControl);
    expect(normalized).not.toContain("javascript:");
    expect(normalized).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(normalized).toMatch(/```js\nconst value = 1;\n```$/);

    process.env.APPRISE_URL = "http://apprise.test/notify";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );
    await sendAppriseDigest(
      [
        {
          repository: repo,
          release: { ...release, body: "```text\nunclosed" },
        },
        {
          repository: { ...repo, id: "owner/second" },
          release: { ...release, tag_name: "v2" },
        },
      ],
      "en",
      { ...baseSettings, appriseFormat: "markdown" },
      { format: "markdown" },
    );

    const payload = JSON.parse(
      fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
    );
    const openingFence = payload.body.indexOf("```text");
    const closingFence = payload.body.indexOf("```", openingFence + 3);
    const secondEntry = payload.body.indexOf("owner/second");
    expect(openingFence).toBeGreaterThanOrEqual(0);
    expect(closingFence).toBeGreaterThan(openingFence);
    expect(secondEntry).toBeGreaterThan(closingFence);
  });

  it("isolates colliding Markdown reference definitions between digest entries", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    await sendAppriseDigest(
      [
        {
          repository: repo,
          release: {
            ...release,
            body: "[First docs][shared]\n\n[shared]: https://first.example",
          },
        },
        {
          repository: { ...repo, id: "owner/second" },
          release: {
            ...release,
            tag_name: "v2",
            body: "[Second docs][shared]\n\n[shared]: https://second.example",
          },
        },
      ],
      "en",
      { ...baseSettings, appriseFormat: "markdown" },
      { format: "markdown" },
    );

    const payload = JSON.parse(
      fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
    );
    expect(payload.body).toContain("[First docs](https://first.example/)");
    expect(payload.body).toContain("[Second docs](https://second.example/)");
    expect(payload.body).not.toContain("[shared]:");
  });

  it("uses the no-notes fallback when Markdown normalization removes all content", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, text: "" }),
    );

    await sendAppriseDigest(
      [{ repository: repo, release: { ...release, body: "\u202e" } }],
      "en",
      { ...baseSettings, appriseFormat: "markdown" },
      { format: "markdown" },
    );

    const payload = JSON.parse(
      fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
    );
    expect(payload.body).toContain(
      "**text\\_release\\_notes\\_label**\n\ntext\\_no\\_notes",
    );
    expect(payload.body).not.toContain("\u202e");
  });

  it.each(["text", "markdown"] as const)(
    "isolates technical values and strips injected bidi controls in %s digests",
    async (format) => {
      process.env.APPRISE_URL = "http://apprise.test/notify";
      vi.mocked(global.fetch).mockResolvedValue(
        mockFetchResponse({ status: 200, text: "" }),
      );
      const unsafeControl = "\u202e";
      const repository = {
        id: `owner/${unsafeControl}repository`,
        url: "https://github.com/owner/repository",
      };
      const digestRelease = {
        ...release,
        tag_name: `v${unsafeControl}2`,
        name: `Release ${unsafeControl}name`,
        body: `Release notes ${unsafeControl}body`,
      };

      await sendAppriseDigest(
        [{ repository, release: digestRelease }],
        "ar",
        { ...baseSettings, appriseFormat: format },
        { format },
      );

      const payload = JSON.parse(
        fetchCallBodyText(vi.mocked(global.fetch).mock.calls[0]),
      );
      expect(payload.body).not.toContain(unsafeControl);
      expect(payload.body).toContain("\u2066owner/repository\u2069");
      expect(payload.body).toContain("\u2066v2\u2069");
      expect(payload.body).toContain("\u2068Release name\u2069");
    },
  );
});

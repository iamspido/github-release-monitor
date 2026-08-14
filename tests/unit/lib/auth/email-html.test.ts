describe("auth/email HTML rendering", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("@/lib/auth");
    process.env = {
      ...env,
      BETTER_AUTH_SECRET: "x".repeat(64),
      BETTER_AUTH_URL: "http://localhost:3000",
      MAIL_HOST: "smtp.example.test",
      MAIL_PORT: "587",
      MAIL_FROM_ADDRESS: "from@example.test",
    };
  });

  afterEach(() => {
    vi.doUnmock("better-auth");
    vi.doUnmock("better-auth/db/migration");
    vi.doUnmock("better-auth/next-js");
    vi.doUnmock("better-auth/plugins");
    vi.doUnmock("@better-auth/passkey");
    vi.doUnmock("better-sqlite3");
    vi.doUnmock("nodemailer");
    vi.doUnmock("@/lib/logger");
    process.env = { ...env };
  });

  it("escapes dynamic HTML text and href attributes in auth emails", async () => {
    type MailOptions = { html: string };
    type AuthEmailConfig = {
      emailVerification: {
        sendVerificationEmail: (args: {
          user: { email: string };
          url: string;
          token: string;
        }) => Promise<void>;
      };
      emailAndPassword: {
        sendResetPassword: (args: {
          user: { email: string };
          url: string;
          token: string;
        }) => Promise<void>;
      };
      user: {
        changeEmail: {
          sendChangeEmailConfirmation: (args: {
            user: { email: string };
            newEmail: string;
            url: string;
            token: string;
          }) => Promise<void>;
        };
      };
    };
    const sendMailMock = vi.fn<(_mail: MailOptions) => Promise<void>>(
      async () => undefined,
    );
    const betterAuthMock = vi.fn((config: AuthEmailConfig) => ({ config }));

    vi.doMock("better-auth", () => ({
      betterAuth: betterAuthMock,
    }));
    vi.doMock("better-auth/db/migration", () => ({
      getMigrations: vi.fn(),
    }));
    vi.doMock("better-auth/next-js", () => ({
      nextCookies: () => "next-cookies-plugin",
    }));
    vi.doMock("better-auth/plugins", () => ({
      twoFactor: () => "two-factor-plugin",
      username: () => "username-plugin",
    }));
    vi.doMock("@better-auth/passkey", () => ({
      passkey: () => "passkey-plugin",
    }));
    function DatabaseMock() {
      return {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => undefined),
          run: vi.fn(),
        })),
      };
    }
    vi.doMock("better-sqlite3", () => ({
      default: DatabaseMock,
    }));
    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: () => ({
          sendMail: sendMailMock,
        }),
      },
    }));

    const authModule = await import("@/lib/auth");
    void authModule.auth.api;
    const authConfig = betterAuthMock.mock.calls[0]?.[0];
    if (!authConfig) {
      throw new Error("Expected Better Auth config");
    }

    await authConfig.emailVerification.sendVerificationEmail({
      user: {
        email: `new<user>"'&@example.test`,
      },
      url: `https://example.test/verify?next=<x>&email="a'b\``,
      token: "token",
    });
    await authConfig.user.changeEmail.sendChangeEmailConfirmation({
      user: {
        email: `current<user>"'&@example.test`,
      },
      newEmail: `new<user>"'&@example.test`,
      url: `https://example.test/change?next=<x>&email="a'b\``,
      token: "token",
    });
    await authConfig.emailAndPassword.sendResetPassword({
      user: { email: `reset<user>"'&@example.test` },
      url: `https://example.test/reset?next=<x>&token="a'b\``,
      token: "token",
    });
    const { waitForBackgroundTasks } = await import(
      "@/lib/runtime/background-tasks"
    );
    await waitForBackgroundTasks();

    expect(sendMailMock).toHaveBeenCalledTimes(3);
    const verificationEmail = sendMailMock.mock.calls[0]?.[0];
    const changeEmail = sendMailMock.mock.calls[1]?.[0];
    const resetEmail = sendMailMock.mock.calls[2]?.[0];
    if (!verificationEmail || !changeEmail || !resetEmail) {
      throw new Error("Expected auth emails to be sent");
    }

    expect(verificationEmail.html).toContain(
      "new&lt;user&gt;&quot;&#39;&amp;@example.test",
    );
    expect(verificationEmail.html).toContain(
      'href="https://example.test/verify?next=&lt;x&gt;&amp;email=&quot;a&#39;b&#96;"',
    );
    expect(verificationEmail.html).not.toContain(`new<user>"'&@example.test`);

    expect(changeEmail.html).toContain(
      "current&lt;user&gt;&quot;&#39;&amp;@example.test",
    );
    expect(changeEmail.html).toContain(
      "new&lt;user&gt;&quot;&#39;&amp;@example.test",
    );
    expect(changeEmail.html).toContain(
      'href="https://example.test/change?next=&lt;x&gt;&amp;email=&quot;a&#39;b&#96;"',
    );
    expect(changeEmail.html).not.toContain(`current<user>"'&@example.test`);
    expect(resetEmail.html).toContain(
      'href="https://example.test/reset?next=&lt;x&gt;&amp;token=&quot;a&#39;b&#96;"',
    );
    expect(resetEmail.html).not.toContain("token=\"a'b`");
  });

  it("opens the auth database lazily and logs an actionable message when it fails", async () => {
    const error = new Error("unable to open database file");
    const logErrorMock = vi.fn();
    const betterAuthMock = vi.fn();
    const scopedLogger = {
      error: logErrorMock,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      withScope: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({
      logger: {
        withScope: () => scopedLogger,
      },
    }));
    vi.doMock("better-auth", () => ({
      betterAuth: betterAuthMock,
    }));
    vi.doMock("better-auth/db/migration", () => ({
      getMigrations: vi.fn(),
    }));
    vi.doMock("better-auth/next-js", () => ({
      nextCookies: () => "next-cookies-plugin",
    }));
    vi.doMock("better-auth/plugins", () => ({
      twoFactor: () => "two-factor-plugin",
      username: () => "username-plugin",
    }));
    vi.doMock("@better-auth/passkey", () => ({
      passkey: () => "passkey-plugin",
    }));
    function DatabaseMock() {
      throw error;
    }
    vi.doMock("better-sqlite3", () => ({
      default: DatabaseMock,
    }));
    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: vi.fn(),
      },
    }));

    const authModule = await import("@/lib/auth");
    expect(betterAuthMock).not.toHaveBeenCalled();

    await expect(authModule.ensureAuthDatabaseReady()).rejects.toThrow(
      "unable to open database file",
    );

    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open Better Auth SQLite database"),
      error,
    );
    expect(logErrorMock.mock.calls[0]?.[0]).toContain("/data/auth.db");
    expect(logErrorMock.mock.calls[0]?.[0]).toContain("UID/GID 1001");
  });
});

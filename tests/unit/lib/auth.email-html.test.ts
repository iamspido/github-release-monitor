describe("auth email HTML rendering", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("@/lib/auth");
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
    process.env = { ...env };
  });

  it("escapes dynamic HTML text and href attributes in auth emails", async () => {
    const sendMailMock = vi.fn(async () => undefined);
    const betterAuthMock = vi.fn((config) => ({ config }));

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

    await import("@/lib/auth");
    const authConfig = betterAuthMock.mock.calls[0]?.[0];

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

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const verificationEmail = sendMailMock.mock.calls[0]?.[0];
    const changeEmail = sendMailMock.mock.calls[1]?.[0];

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
  });
});

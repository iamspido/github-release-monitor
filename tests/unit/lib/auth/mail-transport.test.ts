const { createTransportMock, sendMailMock, state } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
  state: { locale: "en" },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock.mockReturnValue({
      sendMail: sendMailMock,
    }),
  },
}));

vi.mock("@/lib/storage/settings", () => ({
  getLocaleSetting: async () => state.locale,
}));

describe("auth mail transport", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
    state.locale = "en";
    process.env = {
      ...envBackup,
      MAIL_HOST: "smtp.internal.test",
      MAIL_PORT: "465",
      MAIL_FROM_ADDRESS: "from@example.test",
      MAIL_TLS_REJECT_UNAUTHORIZED: "false",
    };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("passes the certificate verification opt-out to nodemailer", async () => {
    const { sendNewEmailVerificationEmail } = await import("@/lib/auth/mail");

    await sendNewEmailVerificationEmail({
      newEmail: "to@example.test",
      verificationUrl: "https://app.example.test/verify",
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        tls: {
          rejectUnauthorized: false,
        },
      }),
    );
  });

  it("propagates reset email delivery failures without logging the token", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(
      new Error("SMTP unavailable secret-reset-token"),
    );
    const { sendPasswordResetEmail } = await import("@/lib/auth/mail");
    const resetUrl =
      "https://app.example.test/reset-password?token=secret-reset-token";

    try {
      await expect(
        sendPasswordResetEmail({
          email: "to@example.test",
          resetUrl,
          expiresInSeconds: 900,
        }),
      ).rejects.toThrow("SMTP unavailable");

      expect(
        consoleError.mock.calls.flat().map(String).join(" "),
      ).not.toContain("secret-reset-token");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renders non-minute reset lifetimes without rounding up", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/auth/mail");

    await sendPasswordResetEmail({
      email: "to@example.test",
      resetUrl: "https://app.example.test/reset-password?token=secret",
      expiresInSeconds: 61,
    });

    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({
      text: expect.stringContaining("expires in 61 seconds"),
      html: expect.stringContaining("expires in 61 seconds"),
    });
  });

  it("uses the release notification design for password reset emails", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/auth/mail");

    await sendPasswordResetEmail({
      email: "to@example.test",
      resetUrl: "https://app.example.test/reset-password?token=secret",
      expiresInSeconds: 900,
    });

    const html = String(sendMailMock.mock.calls[0]?.[0]?.html || "");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("background-color: #0d1117");
    expect(html).toContain("background-color: #101928");
    expect(html).toContain('class="container"');
    expect(html).toContain('class="button"');
    expect(html).toContain('class="notice-container"');
    expect(html).toContain(">Reset password</a>");
  });

  it("uses the application locale for password reset email content and direction", async () => {
    state.locale = "de";
    const { sendPasswordResetEmail } = await import("@/lib/auth/mail");

    await sendPasswordResetEmail({
      email: "to@example.test",
      resetUrl: "https://app.example.test/reset-password?token=secret",
      expiresInSeconds: 900,
    });

    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({
      subject: "Passwort für GitHub Release Monitor zurücksetzen",
      text: expect.stringContaining("Dieser Link läuft in 15 Minuten ab"),
      html: expect.stringContaining('<html lang="de" dir="ltr">'),
    });
    expect(sendMailMock.mock.calls[0]?.[0]?.html).toContain(
      ">Passwort zurücksetzen</a>",
    );
  });
});

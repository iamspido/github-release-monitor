const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock.mockReturnValue({
      sendMail: sendMailMock,
    }),
  },
}));

describe("auth mail transport", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
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
});

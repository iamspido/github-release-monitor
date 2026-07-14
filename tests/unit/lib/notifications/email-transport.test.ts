// vitest globals are enabled via vitest.config.ts

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

import { sendEmailMessage } from "@/lib/notifications/email-transport";

describe("notifications/email-transport", () => {
  beforeEach(() => {
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
  });

  it("configures finite SMTP connection and socket timeouts", async () => {
    await sendEmailMessage(
      { host: "smtp.example.com", port: 587 },
      {
        fromName: "Release Monitor",
        fromAddress: "from@example.com",
        to: "to@example.com",
        subject: "New release",
        text: "text",
        html: "<p>text</p>",
      },
    );

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }),
    );
  });
});

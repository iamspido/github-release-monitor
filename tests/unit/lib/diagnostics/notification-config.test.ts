import {
  buildNotificationConfig,
  sanitizeDiagnosticUrl,
} from "@/lib/diagnostics/notification-config";

describe("diagnostics notification config", () => {
  it("does not expose MAIL_PASSWORD in the initial config", () => {
    const config = buildNotificationConfig({
      AUTHENTICATION_METHOD: "Basic",
      MAIL_HOST: "smtp.example.test",
      MAIL_PORT: "587",
      MAIL_FROM_ADDRESS: "from@example.test",
      MAIL_TO_ADDRESS: "to@example.test",
      MAIL_PASSWORD: "super-secret",
    });

    const mailPassword = config.variables.find(
      (variable) => variable.key === "MAIL_PASSWORD",
    );
    expect(mailPassword).toMatchObject({
      isSet: true,
      isSensitive: true,
      revealMode: "password_confirm",
    });
    expect(mailPassword?.displayValue).not.toBe("super-secret");
  });

  it("uses one-click reveal mode for external auth", () => {
    const config = buildNotificationConfig({
      AUTHENTICATION_METHOD: "External",
      MAIL_PASSWORD: "super-secret",
      APPRISE_URL: "http://apprise:8000/notify/key",
    });

    expect(
      config.variables.find((variable) => variable.key === "MAIL_PASSWORD")
        ?.revealMode,
    ).toBe("external_click");
    expect(
      config.variables.find((variable) => variable.key === "APPRISE_URL")
        ?.revealMode,
    ).toBe("external_click");
  });

  it("sanitizes sensitive Apprise URL parts", () => {
    expect(sanitizeDiagnosticUrl("http://apprise:8000/notify")).toBe(
      "http://apprise:8000/notify",
    );
    expect(
      sanitizeDiagnosticUrl(
        "http://user:pass@apprise:8000/notify/my-key?token=abc#frag",
      ),
    ).toBe(
      "http://<hidden>:<hidden>@apprise:8000/notify/<hidden>?token=<hidden>#hidden",
    );
  });

  it("lists the optional SMTP TLS certificate verification variable", () => {
    const config = buildNotificationConfig({
      MAIL_HOST: "smtp.example.test",
      MAIL_PORT: "587",
      MAIL_FROM_ADDRESS: "from@example.test",
      MAIL_TO_ADDRESS: "to@example.test",
      MAIL_TLS_REJECT_UNAUTHORIZED: "false",
    });

    expect(config.isSmtpConfigured).toBe(true);
    expect(
      config.variables.find(
        (variable) => variable.key === "MAIL_TLS_REJECT_UNAUTHORIZED",
      ),
    ).toMatchObject({
      displayValue: "false",
      isSet: true,
      isRequired: false,
      isSensitive: false,
    });
  });
});

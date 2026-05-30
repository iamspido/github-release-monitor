// @vitest-environment jsdom
import type React from "react";
import { act } from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationConfig, UpdateNotificationState } from "@/types";

const revealMailPasswordActionMock = vi.fn();
const revealAppriseUrlActionMock = vi.fn();
const getSecretRevealOptionsActionMock = vi.fn();
const beginSecretRevealStepUpActionMock = vi.fn();
const completeSecretRevealStepUpActionMock = vi.fn();
const verifySecretRevealTotpActionMock = vi.fn();
const passkeySignInMock = vi.fn();
const socialSignInMock = vi.fn();

type PassthroughProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
};
type DialogRootProps = PassthroughProps & {
  open?: boolean;
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: {
      passkey: passkeySignInMock,
      social: socialSignInMock,
    },
  },
}));

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...rest }: PassthroughProps) => (
    <div {...rest}>{children}</div>
  );
  return {
    Dialog: ({ open, children }: DialogRootProps) =>
      open === false ? null : <div>{children}</div>,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});

vi.mock("@/app/actions", () => ({
  revealMailPasswordAction: revealMailPasswordActionMock,
  revealAppriseUrlAction: revealAppriseUrlActionMock,
  getSecretRevealOptionsAction: getSecretRevealOptionsActionMock,
  beginSecretRevealStepUpAction: beginSecretRevealStepUpActionMock,
  completeSecretRevealStepUpAction: completeSecretRevealStepUpActionMock,
  verifySecretRevealTotpAction: verifySecretRevealTotpActionMock,
  checkAppriseStatusAction: vi.fn(),
  sendTestAppriseAction: vi.fn(),
  sendTestEmailAction: vi.fn(),
  setupTestRepositoryAction: vi.fn(),
  triggerAppUpdateCheckAction: vi.fn(),
  triggerReleaseCheckAction: vi.fn(),
}));

function makeNotificationConfig(
  revealMode: "external_click" | "password_confirm",
): NotificationConfig {
  return {
    isSmtpConfigured: true,
    isAppriseConfigured: true,
    variables: [
      {
        key: "MAIL_HOST",
        displayValue: "smtp.example.com",
        isSet: true,
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PORT",
        displayValue: "587",
        isSet: true,
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PASSWORD",
        displayValue: "••••••••",
        isSet: true,
        isRequired: false,
        isSensitive: true,
        revealMode,
      },
      {
        key: "MAIL_FROM_ADDRESS",
        displayValue: "from@example.com",
        isSet: true,
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_TO_ADDRESS",
        displayValue: "to@example.com",
        isSet: true,
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "APPRISE_URL",
        displayValue: "http://apprise:8000/notify/<hidden>",
        isSet: true,
        isRequired: false,
        isSensitive: true,
        revealMode,
      },
    ],
  };
}

const updateNotice: UpdateNotificationState = {
  latestVersion: null,
  currentVersion: "1.0.0",
  lastCheckedAt: null,
  lastCheckError: null,
  hasUpdate: false,
  isDismissed: false,
  shouldNotify: false,
};

async function renderClient(notificationConfig: NotificationConfig) {
  const { TestPageClient } = await import("@/components/test-page-client");
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = ReactDOM.createRoot(div);
  flushSync(() => {
    root.render(
      <TestPageClient
        rateLimitResult={{ data: null }}
        isTokenSet={false}
        gitlabTokenCheck={{ status: "not_set" }}
        codebergTokenCheck={{ status: "not_set" }}
        notificationConfig={notificationConfig}
        appriseStatus={{ status: "ok" }}
        updateNotice={updateNotice}
      />,
    );
  });

  return {
    div,
    cleanup: () => {
      root.unmount();
      div.remove();
    },
  };
}

function getButtonByText(container: ParentNode, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TestPageClient mail password reveal", () => {
  beforeEach(() => {
    revealMailPasswordActionMock.mockReset();
    revealAppriseUrlActionMock.mockReset();
    getSecretRevealOptionsActionMock.mockReset();
    beginSecretRevealStepUpActionMock.mockReset();
    completeSecretRevealStepUpActionMock.mockReset();
    verifySecretRevealTotpActionMock.mockReset();
    passkeySignInMock.mockReset();
    socialSignInMock.mockReset();
    window.history.replaceState({}, "", "/test");
    window.sessionStorage.clear();
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: true,
        totp: false,
        passkey: false,
        socialProviders: [],
      },
    });
  });

  it("reveals MAIL_PASSWORD on one click for external auth mode", async () => {
    revealMailPasswordActionMock.mockResolvedValue({
      success: true,
      value: "mail-secret",
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("external_click"),
    );
    try {
      expect(div.textContent).toContain("MAIL_PASSWORD=••••••••");
      expect(div.textContent).not.toContain("mail-secret");

      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(revealMailPasswordActionMock).toHaveBeenCalledTimes(1);
      expect(div.textContent).toContain("MAIL_PASSWORD=mail-secret");

      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="hide_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });

      expect(div.textContent).toContain("MAIL_PASSWORD=••••••••");
      expect(div.textContent).not.toContain("mail-secret");
    } finally {
      cleanup();
    }
  });

  it("opens a password confirmation dialog for internal auth mode", async () => {
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });

      expect(document.body.textContent).toContain(
        "mail_password_reveal_title",
      );
      expect(revealMailPasswordActionMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("shows configured step-up alternatives for internal auth mode", async () => {
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: false,
        totp: true,
        passkey: true,
        socialProviders: ["github", "google"],
      },
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        document.body.querySelector(
          'input[placeholder="secret_reveal_totp_placeholder"]',
        ),
      ).toBeTruthy();
      expect(document.body.textContent).toContain(
        "secret_reveal_passkey_button",
      );
      expect(
        Array.from(document.body.querySelectorAll("button")).filter((button) =>
          button.textContent?.includes("secret_reveal_social_button"),
        ),
      ).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it("reveals MAIL_PASSWORD after TOTP step-up", async () => {
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: false,
        totp: true,
        passkey: false,
        socialProviders: [],
      },
    });
    verifySecretRevealTotpActionMock.mockResolvedValue({ success: true });
    revealMailPasswordActionMock.mockResolvedValue({
      success: true,
      value: "mail-secret",
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      const input = document.body.querySelector(
        'input[placeholder="secret_reveal_totp_placeholder"]',
      ) as HTMLInputElement;
      await act(async () => {
        setInputValue(input, "123456");
        await Promise.resolve();
      });

      await act(async () => {
        getButtonByText(document.body, "secret_reveal_totp_button").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(verifySecretRevealTotpActionMock).toHaveBeenCalledWith({
        code: "123456",
      });
      expect(revealMailPasswordActionMock).toHaveBeenCalledWith();
      expect(div.textContent).toContain("MAIL_PASSWORD=mail-secret");
    } finally {
      cleanup();
    }
  });

  it("reveals MAIL_PASSWORD after passkey step-up", async () => {
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: false,
        totp: false,
        passkey: true,
        socialProviders: [],
      },
    });
    beginSecretRevealStepUpActionMock.mockResolvedValue({ success: true });
    passkeySignInMock.mockResolvedValue({ data: {}, error: null });
    completeSecretRevealStepUpActionMock.mockResolvedValue({ success: true });
    revealMailPasswordActionMock.mockResolvedValue({
      success: true,
      value: "mail-secret",
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        getButtonByText(document.body, "secret_reveal_passkey_button").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(beginSecretRevealStepUpActionMock).toHaveBeenCalledWith({
        method: "passkey",
      });
      expect(passkeySignInMock).toHaveBeenCalled();
      expect(completeSecretRevealStepUpActionMock).toHaveBeenCalled();
      expect(revealMailPasswordActionMock).toHaveBeenCalledWith();
      expect(div.textContent).toContain("MAIL_PASSWORD=mail-secret");
    } finally {
      cleanup();
    }
  });

  it("starts social step-up with a callback to the diagnostics page", async () => {
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: false,
        totp: false,
        passkey: false,
        socialProviders: ["github"],
      },
    });
    beginSecretRevealStepUpActionMock.mockResolvedValue({ success: true });
    socialSignInMock.mockResolvedValue({ data: {}, error: null });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_password"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        getButtonByText(document.body, "secret_reveal_social_button").click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(beginSecretRevealStepUpActionMock).toHaveBeenCalledWith({
        method: "social",
        provider: "github",
      });
      expect(socialSignInMock).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: `${window.location.pathname}?secretRevealStepUp=1`,
      });
      expect(window.sessionStorage.getItem("diagnosticSecretRevealTarget")).toBe(
        "mail_password",
      );
    } finally {
      window.sessionStorage.clear();
      cleanup();
    }
  });

  it("reveals APPRISE_URL on one click for external auth mode", async () => {
    revealAppriseUrlActionMock.mockResolvedValue({
      success: true,
      value: "http://apprise:8000/notify/key",
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("external_click"),
    );
    try {
      expect(div.textContent).toContain(
        "APPRISE_URL=http://apprise:8000/notify/<hidden>",
      );
      expect(div.textContent).not.toContain("/notify/key");

      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="show_secret"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(div.textContent).toContain(
        "APPRISE_URL=http://apprise:8000/notify/key",
      );

      await act(async () => {
        (
          div.querySelector(
            'button[aria-label="hide_secret"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });

      expect(div.textContent).toContain(
        "APPRISE_URL=http://apprise:8000/notify/<hidden>",
      );
      expect(div.textContent).not.toContain("/notify/key");
    } finally {
      cleanup();
    }
  });
});

// @vitest-environment jsdom
import type React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_REVEAL_TARGET_STORAGE_KEY } from "@/components/diagnostics/secret-reveal-model";
import type {
  ForgejoTokenCheckResult,
  NotificationConfig,
  UpdateNotificationState,
} from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const revealMailPasswordActionMock = vi.fn();
const revealAppriseUrlActionMock = vi.fn();
const getSecretRevealOptionsActionMock = vi.fn();
const beginSecretRevealStepUpActionMock = vi.fn();
const completeSecretRevealStepUpActionMock = vi.fn();
const verifySecretRevealTotpActionMock = vi.fn();
const passkeySignInMock = vi.fn();
const socialSignInMock = vi.fn();
let browserTimeZone: string | null = "UTC";
let TestPageClientComponent: typeof import("@/components/test-page-client").TestPageClient;

type PassthroughProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
};
type DialogRootProps = PassthroughProps & {
  open?: boolean;
};

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock("@/hooks/use-browser-time-zone", () => ({
  useBrowserTimeZone: () => browserTimeZone,
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
        displayValue: "smtp.example.test",
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
        displayValue: "from@example.test",
        isSet: true,
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_TO_ADDRESS",
        displayValue: "to@example.test",
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
  latestReleaseTitle: null,
  latestSecurityVersion: null,
  currentVersion: "1.0.0",
  lastCheckedAt: null,
  lastCheckError: null,
  hasUpdate: false,
  isDismissed: false,
  isSecurityUpdate: false,
  shouldNotify: false,
};

async function renderClient(
  notificationConfig: NotificationConfig,
  notice: UpdateNotificationState = updateNotice,
  forgejoTokenChecks: ForgejoTokenCheckResult[] = [],
) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = ReactDOM.createRoot(div);
  await act(async () => {
    root.render(
      <TestPageClientComponent
        rateLimitResult={{ data: null }}
        isTokenSet={false}
        gitlabTokenCheck={{ status: "not_set" }}
        codebergTokenCheck={{ status: "not_set" }}
        forgejoTokenChecks={forgejoTokenChecks}
        notificationConfig={notificationConfig}
        appriseStatus={{ status: "ok" }}
        updateNotice={notice}
        timeFormat="24h"
      />,
    );
    await Promise.resolve();
  });

  return {
    div,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      div.remove();
    },
  };
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForExpectation(assertion: () => void, attempts = 12) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await flushReactWork();
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  assertion();
  throw lastError;
}

function getButtonByAriaLabel(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(
    `button[aria-label="${ariaLabel}"]`,
  ) as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function clickButtonAndWaitFor(
  container: ParentNode,
  ariaLabel: string,
  assertion: () => void,
) {
  let button: HTMLButtonElement | null = null;
  await waitForExpectation(() => {
    button = getButtonByAriaLabel(container, ariaLabel);
    expect(button.disabled).toBe(false);
  });

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await waitForExpectation(assertion);
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
  beforeAll(async () => {
    const mod = await import("@/components/test-page-client");
    TestPageClientComponent = mod.TestPageClient;
  }, 30_000);

  beforeEach(() => {
    vi.useRealTimers();
    revealMailPasswordActionMock.mockReset();
    revealAppriseUrlActionMock.mockReset();
    getSecretRevealOptionsActionMock.mockReset();
    beginSecretRevealStepUpActionMock.mockReset();
    completeSecretRevealStepUpActionMock.mockReset();
    verifySecretRevealTotpActionMock.mockReset();
    passkeySignInMock.mockReset();
    socialSignInMock.mockReset();
    browserTimeZone = "UTC";
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

  it("does not report an existing check as never before timezone hydration", async () => {
    browserTimeZone = null;
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("external_click"),
      {
        ...updateNotice,
        lastCheckedAt: "2026-07-27T12:00:00.000Z",
      },
    );

    try {
      expect(div.textContent).toContain("update_last_checked");
      expect(div.textContent).not.toContain("update_last_checked_never");
    } finally {
      cleanup();
    }
  });

  it("renders every Forgejo diagnostics status for configured instances", async () => {
    const checks: ForgejoTokenCheckResult[] = [
      { baseUrl: "https://public.example.test", status: "not_set" },
      {
        baseUrl: "https://unreachable.example.test",
        status: "not_set",
        connectivityError: true,
      },
      {
        baseUrl: "https://limited.example.test/code",
        status: "valid",
        login: null,
        fullName: null,
        diagnosticsLimited: true,
      },
      {
        baseUrl: "https://valid.example.test",
        status: "valid",
        login: "forgejo-user",
        fullName: "Forgejo User",
      },
      { baseUrl: "https://invalid.example.test", status: "invalid_token" },
      { baseUrl: "https://offline.example.test", status: "api_error" },
    ];
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("external_click"),
      updateNotice,
      checks,
    );

    try {
      expect(div.textContent).toContain("https://public.example.test");
      expect(div.textContent).toContain("forgejo_token_not_set");
      expect(div.textContent).toContain("forgejo_token_advice");
      expect(div.textContent).toContain("forgejo_connectivity_confirmed");
      expect(div.textContent).toContain("forgejo_token_check_error");
      expect(div.textContent).toContain("https://limited.example.test/code");
      expect(div.textContent).toContain("forgejo_token_valid_limited_advice");
      expect(div.textContent).toContain("forgejo_authenticated_as");
      expect(div.textContent).toContain("Forgejo User");
      expect(div.textContent).toContain("forgejo_invalid_token_advice");
      expect(div.textContent).toContain("forgejo_token_check_error_advice");
    } finally {
      cleanup();
    }
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

      await clickButtonAndWaitFor(div, "show_password", () => {
        expect(revealMailPasswordActionMock).toHaveBeenCalledTimes(1);
        expect(div.textContent).toContain("MAIL_PASSWORD=mail-secret");
      });

      await clickButtonAndWaitFor(div, "hide_password", () => {
        expect(div.textContent).toContain("MAIL_PASSWORD=••••••••");
        expect(div.textContent).not.toContain("mail-secret");
      });
    } finally {
      cleanup();
    }
  });

  it("opens a password confirmation dialog for internal auth mode", async () => {
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await clickButtonAndWaitFor(div, "show_password", () => {
        expect(document.body.textContent).toContain(
          "mail_password_reveal_title",
        );
      });

      expect(document.body.textContent).toContain("mail_password_reveal_title");
      expect(revealMailPasswordActionMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("shows supported step-up alternatives for internal auth mode", async () => {
    getSecretRevealOptionsActionMock.mockResolvedValue({
      success: true,
      methods: {
        password: false,
        totp: true,
        passkey: false,
        socialProviders: ["github", "google"],
      },
    });
    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await clickButtonAndWaitFor(div, "show_password", () => {
        expect(
          document.body.querySelector(
            'input[placeholder="secret_reveal_totp_placeholder"]',
          ),
        ).toBeTruthy();
      });

      expect(
        document.body.querySelector(
          'input[placeholder="secret_reveal_totp_placeholder"]',
        ),
      ).toBeTruthy();
      expect(document.body.textContent).not.toContain(
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
      await clickButtonAndWaitFor(div, "show_password", () => {
        expect(
          document.body.querySelector(
            'input[placeholder="secret_reveal_totp_placeholder"]',
          ),
        ).toBeTruthy();
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
      });
      await waitForExpectation(() => {
        expect(div.textContent).toContain("MAIL_PASSWORD=mail-secret");
      });

      expect(verifySecretRevealTotpActionMock).toHaveBeenCalledWith({
        code: "123456",
        target: "mail_password",
      });
      expect(revealMailPasswordActionMock).toHaveBeenCalledWith();
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
      await clickButtonAndWaitFor(div, "show_password", () => {
        expect(
          getButtonByText(document.body, "secret_reveal_social_button"),
        ).toBeTruthy();
      });

      await act(async () => {
        getButtonByText(document.body, "secret_reveal_social_button").click();
        await Promise.resolve();
      });

      expect(beginSecretRevealStepUpActionMock).toHaveBeenCalledWith({
        method: "social",
        provider: "github",
        target: "mail_password",
      });
      expect(socialSignInMock).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: `${window.location.pathname}?secretRevealStepUp=1`,
      });
      expect(
        window.sessionStorage.getItem(SECRET_REVEAL_TARGET_STORAGE_KEY),
      ).toBe("mail_password");
    } finally {
      window.sessionStorage.clear();
      cleanup();
    }
  });

  it("completes social step-up and reveals the stored target after the callback", async () => {
    completeSecretRevealStepUpActionMock.mockResolvedValue({ success: true });
    revealAppriseUrlActionMock.mockResolvedValue({
      success: true,
      value: "http://apprise:8000/notify/key",
    });
    window.sessionStorage.setItem(
      SECRET_REVEAL_TARGET_STORAGE_KEY,
      "apprise_url",
    );
    window.history.replaceState({}, "", "/test?secretRevealStepUp=1");

    const { div, cleanup } = await renderClient(
      makeNotificationConfig("password_confirm"),
    );
    try {
      await waitForExpectation(() => {
        expect(completeSecretRevealStepUpActionMock).toHaveBeenCalledWith({
          target: "apprise_url",
        });
        expect(revealAppriseUrlActionMock).toHaveBeenCalledWith();
        expect(div.textContent).toContain(
          "APPRISE_URL=http://apprise:8000/notify/key",
        );
      });

      expect(completeSecretRevealStepUpActionMock).toHaveBeenCalledTimes(1);
      expect(revealAppriseUrlActionMock).toHaveBeenCalledTimes(1);
      expect(
        window.sessionStorage.getItem(SECRET_REVEAL_TARGET_STORAGE_KEY),
      ).toBeNull();
      expect(window.location.pathname).toBe("/test");
      expect(window.location.search).toBe("");
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

      await clickButtonAndWaitFor(div, "show_secret", () => {
        expect(div.textContent).toContain(
          "APPRISE_URL=http://apprise:8000/notify/key",
        );
      });

      await clickButtonAndWaitFor(div, "hide_secret", () => {
        expect(div.textContent).toContain(
          "APPRISE_URL=http://apprise:8000/notify/<hidden>",
        );
        expect(div.textContent).not.toContain("/notify/key");
      });
    } finally {
      cleanup();
    }
  });
});

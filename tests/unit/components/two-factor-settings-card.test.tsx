// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionState: {
  data: { user: { twoFactorEnabled: boolean } };
  isPending: boolean;
};
const disableTwoFactorMock = vi.fn();
const enableTwoFactorMock = vi.fn();
const verifyTwoFactorMock = vi.fn();
const toDataUrlMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}));

vi.mock("qrcode", () => ({
  toDataURL: (...args: unknown[]) => toDataUrlMock(...args),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

vi.mock("@/lib/auth/client-adapters", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/client-adapters")>();
  return {
    ...original,
    disableTwoFactor: (...args: unknown[]) => disableTwoFactorMock(...args),
    enableTwoFactor: (...args: unknown[]) => enableTwoFactorMock(...args),
    verifyTwoFactor: (...args: unknown[]) => verifyTwoFactorMock(...args),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("TwoFactorSettingsCard", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    sessionState = {
      data: { user: { twoFactorEnabled: false } },
      isPending: false,
    };
    disableTwoFactorMock.mockReset();
    enableTwoFactorMock.mockReset();
    verifyTwoFactorMock.mockReset();
    toDataUrlMock.mockReset();
    disableTwoFactorMock.mockResolvedValue(true);
    verifyTwoFactorMock.mockResolvedValue(true);
    toDataUrlMock.mockResolvedValue("data:image/png;base64,qr");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderCard() {
    const { TwoFactorSettingsCard } = await import(
      "@/components/two-factor-settings-card"
    );
    await act(async () => {
      root.render(<TwoFactorSettingsCard />);
      await Promise.resolve();
    });
  }

  it("enables setup, verifies the code, and clears setup secrets", async () => {
    enableTwoFactorMock.mockResolvedValue({
      totpURI: "otpauth://totp/example",
      backupCodes: ["backup-1", "backup-2"],
    });
    await renderCard();
    const password = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(password, "secret"));
    const enableButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("two_factor_enable_button"),
    );

    await act(async () => {
      enableButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enableTwoFactorMock).toHaveBeenCalledWith("secret");
    expect(container.textContent).toContain("backup-1");
    expect(
      (container.querySelector("input[readonly]") as HTMLInputElement).value,
    ).toBe("otpauth://totp/example");
    expect(toDataUrlMock).toHaveBeenCalledWith(
      "otpauth://totp/example",
      expect.objectContaining({ width: 224 }),
    );

    const code = container.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(code, " 123456 "));
    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("two_factor_verify_button"),
    );
    await act(async () => {
      verifyButton?.click();
      await Promise.resolve();
    });

    expect(verifyTwoFactorMock).toHaveBeenCalledWith("123456", true);
    expect(container.textContent).toContain("two_factor_enabled");
    expect(container.textContent).not.toContain("backup-1");
  });

  it("keeps setup open when verification fails", async () => {
    enableTwoFactorMock.mockResolvedValue({
      totpURI: "otpauth://totp/example",
      backupCodes: ["backup-1"],
    });
    verifyTwoFactorMock.mockResolvedValue(false);
    await renderCard();
    const password = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(password, "secret"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes("two_factor_enable_button"),
        )
        ?.click();
      await Promise.resolve();
    });
    const code = container.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(code, "123456"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes("two_factor_verify_button"),
        )
        ?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("two_factor_error_verify");
    expect(container.textContent).toContain("backup-1");
  });

  it("disables an enabled second factor", async () => {
    sessionState.data.user.twoFactorEnabled = true;
    await renderCard();
    const password = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(password, "secret"));
    const disableButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("two_factor_disable_button"),
    );

    await act(async () => {
      disableButton?.click();
      await Promise.resolve();
    });

    expect(disableTwoFactorMock).toHaveBeenCalledWith("secret");
    expect(container.textContent).toContain("two_factor_disabled");
  });

  it("shows enable and disable errors without changing state", async () => {
    enableTwoFactorMock.mockResolvedValue(null);
    await renderCard();
    const enablePassword = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(enablePassword, "secret"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes("two_factor_enable_button"),
        )
        ?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("two_factor_error_enable");
    expect(container.textContent).toContain("two_factor_disabled");

    act(() => root.unmount());
    root = ReactDOM.createRoot(container);
    sessionState.data.user.twoFactorEnabled = true;
    disableTwoFactorMock.mockResolvedValue(false);
    await renderCard();
    const disablePassword = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => setInputValue(disablePassword, "secret"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes("two_factor_disable_button"),
        )
        ?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("two_factor_error_disable");
    expect(container.textContent).toContain("two_factor_enabled");
  });
});

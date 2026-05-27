// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let networkState = { isOnline: true };
const listAccountsMock = vi.fn();
const useSessionMock = vi.fn();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const map: Record<string, string> = {
      account_credentials_title: "Email & password",
      account_credentials_description: "Manage credentials",
      account_email_current_value: `Current email: ${values?.value ?? ""}`,
      account_email_not_set: "not set",
      account_email_new_label: "New email",
      account_email_new_placeholder: "name@example.com",
      account_email_save_button: "Save email",
      account_password_status_loading: "Checking password status...",
      account_password_status_set: "Password exists",
      account_password_status_not_set: "No password set yet",
      account_password_current_label: "Current password",
      account_password_new_label: "New password",
      account_password_confirm_label: "Confirm password",
      account_password_change_button: "Change password",
      account_password_set_button: "Set password",
      account_password_current_placeholder: "Current password",
      account_password_new_placeholder: "At least 12 characters",
      account_password_confirm_placeholder: "Repeat password",
      account_password_policy_hint:
        "Minimum 12 characters with uppercase, lowercase, and a number.",
      show_password: "Show password",
      hide_password: "Hide password",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => networkState,
}));

vi.mock("@/app/auth/settings-actions", () => ({
  updateAccountEmailAction: vi.fn(async () => ({ ok: true })),
  updateAccountPasswordAction: vi.fn(async () => ({ ok: true, mode: "set" })),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    listAccounts: (...args: unknown[]) => listAccountsMock(...args),
    useSession: (...args: unknown[]) => useSessionMock(...args),
  },
}));

describe("AccountCredentialsSettingsCard", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    networkState = { isOnline: true };
    listAccountsMock.mockReset();
    useSessionMock.mockReset();
    listAccountsMock.mockResolvedValue({ data: [] });
    useSessionMock.mockReturnValue({
      data: { user: { email: null } },
      isPending: false,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderCard() {
    const { AccountCredentialsSettingsCard } = await import(
      "@/components/account-credentials-settings-card"
    );
    await act(async () => {
      root.render(<AccountCredentialsSettingsCard />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function setControlledInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("renders current email fallback when user has no email", async () => {
    await renderCard();
    expect(container.textContent).toContain("Current email: not set");
  });

  it("shows 'Set password' flow when no credential account is linked", async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: "github" }],
    });
    await renderCard();

    expect(container.textContent).toContain("No password set yet");
    expect(container.textContent).toContain("Set password");
    expect(container.textContent).not.toContain("Current password");
  });

  it("shows 'Change password' flow when credential account is linked", async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: "credential" }],
    });
    await renderCard();

    expect(container.textContent).toContain("Password exists");
    expect(container.textContent).toContain("Change password");
    expect(container.textContent).toContain("Current password");
  });

  it("toggles password visibility for all password inputs", async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: "credential" }],
    });
    await renderCard();

    const currentPasswordInput = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement | null;
    const newPasswordInputs = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];

    expect(currentPasswordInput).toBeTruthy();
    expect(newPasswordInputs.length).toBe(2);
    expect(currentPasswordInput?.type).toBe("password");
    newPasswordInputs.forEach((input) => {
      expect(input.type).toBe("password");
    });

    const showButton = container.querySelector(
      'button[aria-label="Show password"]',
    ) as HTMLButtonElement | null;
    expect(showButton).toBeTruthy();

    await act(async () => {
      showButton?.click();
    });

    expect(currentPasswordInput?.type).toBe("text");
    newPasswordInputs.forEach((input) => {
      expect(input.type).toBe("text");
    });

    const hideButton = container.querySelector(
      'button[aria-label="Hide password"]',
    ) as HTMLButtonElement | null;
    expect(hideButton).toBeTruthy();

    await act(async () => {
      hideButton?.click();
    });

    expect(currentPasswordInput?.type).toBe("password");
    newPasswordInputs.forEach((input) => {
      expect(input.type).toBe("password");
    });
  });

  it("enables password submit only when new and confirm passwords match", async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: "credential" }],
    });
    await renderCard();

    const currentPasswordField = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement | null;
    const passwordInputs = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];
    const [newPasswordField, confirmPasswordField] = passwordInputs;
    expect(currentPasswordField).toBeTruthy();
    expect(newPasswordField).toBeTruthy();
    expect(confirmPasswordField).toBeTruthy();

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("Set password") ||
        button.textContent?.includes("Change password"),
    ) as HTMLButtonElement | undefined;
    expect(submitButton).toBeTruthy();
    expect(submitButton?.disabled).toBe(true);

    await act(async () => {
      if (currentPasswordField) {
        setControlledInputValue(currentPasswordField, "CurrentPassword123");
      }
      setControlledInputValue(newPasswordField, "StrongPassword123");
      setControlledInputValue(confirmPasswordField, "StrongPassword321");
      await Promise.resolve();
    });

    expect(submitButton?.disabled).toBe(true);

    await act(async () => {
      setControlledInputValue(confirmPasswordField, "StrongPassword123");
      await Promise.resolve();
    });

    expect(submitButton?.disabled).toBe(false);
  });
});

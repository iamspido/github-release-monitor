// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let networkState = { isOnline: true };
const listAccountsMock = vi.fn();
const useSessionMock = vi.fn();
const updateAccountEmailMock = vi.fn();
const updateAccountPasswordMock = vi.fn();

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
      account_email_new_placeholder: "name@example.test",
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
  updateAccountEmailAction: (...args: unknown[]) =>
    updateAccountEmailMock(...args),
  updateAccountPasswordAction: (...args: unknown[]) =>
    updateAccountPasswordMock(...args),
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
    updateAccountEmailMock.mockReset();
    updateAccountPasswordMock.mockReset();
    listAccountsMock.mockResolvedValue({ data: [] });
    useSessionMock.mockReturnValue({
      data: { user: { email: null } },
      isPending: false,
    });
    updateAccountEmailMock.mockResolvedValue({ ok: true, mode: "updated" });
    updateAccountPasswordMock.mockResolvedValue({ ok: true, mode: "set" });
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

  it("isolates the current email address as left-to-right text", async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: "user@example.test" } },
      isPending: false,
    });

    await renderCard();

    expect(container.textContent).toContain(
      "Current email: \u2066user@example.test\u2069",
    );
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

  it("does not accept whitespace in new password inputs", async () => {
    await renderCard();

    const [newPasswordField, confirmPasswordField] = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];

    await act(async () => {
      setControlledInputValue(newPasswordField, "StrongPassword123");
      setControlledInputValue(confirmPasswordField, "StrongPassword123");
      await Promise.resolve();
    });

    await act(async () => {
      setControlledInputValue(newPasswordField, "Strong Password123");
      setControlledInputValue(confirmPasswordField, "StrongPassword123 ");
      await Promise.resolve();
    });

    expect(newPasswordField.value).toBe("StrongPassword123");
    expect(confirmPasswordField.value).toBe("StrongPassword123");
  });

  it("submits a normalized email and updates the displayed value", async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: "old@example.test" } },
      isPending: false,
    });
    await renderCard();

    const emailInput = container.querySelector(
      'input[autocomplete="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      setControlledInputValue(emailInput, " NEW@EXAMPLE.TEST ");
      await Promise.resolve();
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save email"),
    );

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateAccountEmailMock).toHaveBeenCalledWith({
      newEmail: "NEW@EXAMPLE.TEST",
      callbackURL: "/",
    });
    expect(container.textContent).toContain(
      "Current email: \u2066new@example.test\u2069",
    );
    expect(container.textContent).toContain("account_email_update_success");
    expect(emailInput.value).toBe("");
  });

  it.each([
    [{ ok: false, errorKey: "account_email_in_use" }, "account_email_in_use"],
    [new Error("offline"), "account_email_update_failed"],
  ])("shows email update failures", async (result, expectedError) => {
    if (result instanceof Error) {
      updateAccountEmailMock.mockRejectedValueOnce(result);
    } else {
      updateAccountEmailMock.mockResolvedValueOnce(result);
    }
    await renderCard();

    const emailInput = container.querySelector(
      'input[autocomplete="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      setControlledInputValue(emailInput, "new@example.test");
      await Promise.resolve();
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save email"),
    );
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(expectedError);
  });

  it("sets a password and clears the submitted fields", async () => {
    await renderCard();
    const [newPasswordField, confirmPasswordField] = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];

    await act(async () => {
      setControlledInputValue(newPasswordField, "StrongPassword123");
      setControlledInputValue(confirmPasswordField, "StrongPassword123");
      await Promise.resolve();
    });
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Set password"),
    );
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateAccountPasswordMock).toHaveBeenCalledWith({
      currentPassword: "",
      newPassword: "StrongPassword123",
    });
    expect(container.textContent).toContain("account_password_set_success");
    expect(newPasswordField.value).toBe("");
    expect(confirmPasswordField.value).toBe("");
    expect(container.textContent).toContain("Change password");
  });

  it("shows backend password errors and preserves the entered password", async () => {
    updateAccountPasswordMock.mockResolvedValueOnce({
      ok: false,
      errorKey: "account_password_current_invalid",
    });
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: "credential" }],
    });
    await renderCard();

    const currentPasswordField = container.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    const [newPasswordField, confirmPasswordField] = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];
    await act(async () => {
      setControlledInputValue(currentPasswordField, "WrongPassword123");
      setControlledInputValue(newPasswordField, "StrongPassword123");
      setControlledInputValue(confirmPasswordField, "StrongPassword123");
      await Promise.resolve();
    });
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change password"),
    );
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("account_password_current_invalid");
    expect(newPasswordField.value).toBe("StrongPassword123");
  });

  it("disables credential mutations while offline", async () => {
    networkState = { isOnline: false };
    await renderCard();

    const buttons = Array.from(container.querySelectorAll("button"));
    const emailButton = buttons.find((button) =>
      button.textContent?.includes("Save email"),
    );
    const passwordButton = buttons.find((button) =>
      button.textContent?.includes("Set password"),
    );

    expect(emailButton?.disabled).toBe(true);
    expect(passwordButton?.disabled).toBe(true);
  });
});
